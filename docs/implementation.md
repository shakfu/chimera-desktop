# Implementation notes

The non-obvious bits of chimera-desktop's plumbing. Companion to the
top-level [`README.md`](../README.md) (user-facing) and
[`upstream-rebase.md`](upstream-rebase.md) (rebase recipe for the
vendored upstream webui).

A Tauri shell on top of a heavily-configured upstream SvelteKit app
hits a small set of non-obvious problems. This document captures the
four real bugs that took serious debugging and the fixes — partly so
future you doesn't relearn them, partly so anyone forking this for a
similar use case has a head start.

---

## Why this was difficult — the honest retrospective

Two red herrings to dispel first, because they came up repeatedly
during the debugging and neither was the real cause:

- **It was not about a missing `/props` endpoint.** chimera had
  `/props` from the start. The 404s we kept seeing in devtools were
  not chimera saying "I don't know that route" — they were the
  *vite dev server* returning 404 because our fetches were going
  to `http://localhost:1420/props` instead of being rewritten to
  the chimera sidecar at `http://127.0.0.1:<port>/props`.
- **It was not about a missing `--cors` flag in chimera.** chimera
  does send `Access-Control-Allow-Origin` headers (verified via
  `curl -is`). We never needed a chimera-side CORS change. The
  webview-side blocker turned out to be something else, and the
  fix lives entirely on the chimera-desktop side.

The real cause was self-inflicted. We wrapped `globalThis.fetch` to
redirect chimera-bound URLs to the dynamic sidecar port — a
reasonable design on paper. But Tauri 2's IPC on macOS uses `fetch`
internally (to `ipc://localhost/...`) to deliver `invoke()` messages
to Rust. Our wrapper put every fetch behind `await baseReady`, a
promise fulfilled by `invoke('sidecar_port')`. So:

1. `invoke()` calls `fetch('ipc://localhost/...')` to reach Rust.
2. The wrapper intercepts and awaits `baseReady`.
3. `baseReady` only resolves once `invoke()` succeeds.
4. Cycle complete — nothing makes progress.

The fix was one line: make the await **conditional**. Only wait
for URLs that would actually be rewritten to chimera. Once `ipc://`
URLs pass through unblocked, IPC works, `baseReady` resolves, and
every chimera-bound fetch that was queued behind it unblocks.

The other three problems documented below (CORS / COEP, absolute
URLs bypassing the rewriter, sticky "Server unavailable") all
appeared *after* the deadlock fix and were quicker to diagnose.

### Why it took hours instead of minutes

The bug was easy to fix once found. Finding it was the hard part,
because of how Tauri 2 IPC fails:

- **A failed `invoke()` doesn't throw or reject — it just hangs.**
  The Promise stays in "pending" state forever. No console error.
  No exception bubbles up. No Rust log lines. The bug is *invisible*
  through normal debugging tools.
- **Every other system surfaces failures somehow** (HTTP 500,
  exception event, error log, denied permission). Tauri IPC
  silently goes nowhere if anything between the JS-side `invoke()`
  and the Rust-side dispatcher is broken.
- The only way to localize it was **progressive isolation**:
  disable plugins → disable setup hook → replace `+layout.svelte`
  with a stub → re-add upstream imports one by one → finally
  re-add the chimera-desktop wrapper itself, at which point it
  reproduced and the fault was clear.

The single most useful diagnostic was scaffolding a fresh
`npm create tauri-app` in a temp dir to confirm Tauri itself
worked on the same machine. That single experiment narrowed the
search from "Tauri / macOS / WebKit / network / config" to
"something specific to our app code" and unblocked the rest of
the bisect.

### Meta-lesson

When wrapping any global JS primitive in a Tauri app — `fetch`,
`XMLHttpRequest`, `postMessage`, `localStorage`, even `Promise` —
**assume Tauri's IPC layer uses it internally**. Never block such
a primitive on anything that itself depends on a Rust command;
that's a guaranteed deadlock. The Tauri 2 docs don't call this out
because most apps don't wrap global fetch — but heavily-configured
SvelteKit forks that need URL rewriting do.

---

## 1. `globalThis.fetch` wrapping deadlocks Tauri IPC

**Symptom.** Every `invoke()` call from the webview returns a
`Promise` that stays pending forever. No error, no Rust log lines,
no console output. The UI sits at "Connecting to Server"
indefinitely.

**Cause.** chimera-desktop wraps `globalThis.fetch` to redirect
chimera-bound API calls. The wrapper originally did `await baseReady`
(a one-shot promise resolved by `resolveChimeraSidecar()` once
`invoke('sidecar_port')` returns) before every fetch.

What we didn't know: Tauri 2's IPC custom protocol on macOS uses
`fetch` to `ipc://localhost/...` to deliver invoke messages. So:

1. JS calls `invoke('sidecar_port')`.
2. Internally, Tauri's invoke fires `fetch('ipc://...')` to talk to Rust.
3. Our wrapper intercepts the fetch and awaits `baseReady`.
4. `baseReady` is fulfilled by the result of `invoke('sidecar_port')`.
5. Cycle complete — nothing makes progress.

**Fix.** Make the wait *conditional*. Only `await baseReady` for
URLs that would actually be rewritten to chimera (origin matches the
webview, path matches a chimera API prefix). `ipc://` and `tauri://`
URLs pass straight through to native fetch. Code in
`src/lib/chimera/sidecar.ts`'s `wouldRewrite()` helper.

---

## 2. CORS / COEP block chimera-bound requests

**Symptom.** Requests to `http://127.0.0.1:<port>/props` fail with
no informative error visible.

**Cause.** The webview origin in dev is `http://localhost:1420`
(vite) and in production is `tauri://localhost`. The chimera sidecar
listens on `http://127.0.0.1:<dynamic-port>`. These are
cross-origin, so the browser fetch enforces CORS. chimera's HTTP
server does send `Access-Control-Allow-Origin`, but upstream's vite
config also kept COEP `require-corp` headers (for Pyodide, which we
don't use), which adds a separate Cross-Origin-Resource-Policy
requirement that chimera doesn't satisfy.

**Fix.** Two parts:

1. Removed COEP / COOP headers from `vite.config.ts` (chimera-desktop
   doesn't use Pyodide; re-add if that changes).
2. Route every rewritten chimera URL through
   `@tauri-apps/plugin-http`'s `fetch` instead of the browser's
   native `fetch`. The plugin's fetch goes via Rust's `reqwest` and
   is not subject to the webview's CORS / COEP rules.

Non-chimera URLs (vite HMR, blob URLs, data URLs) stay on the
browser fetch — only chimera-bound requests take the Tauri-http
detour.

---

## 3. Upstream's absolute URLs bypass the rewriter

**Symptom.** After fixing the deadlock and CORS, the chat UI still
showed "Server unavailable / Server endpoint not found". DevTools
network tab revealed requests going to `http://localhost:1420/props`
instead of the rewritten chimera URL.

**Cause.** Upstream's code constructs `Request` objects for some
fetches. When you create a `Request` with a relative URL, the
browser absolutizes it against the document's origin *immediately*.
By the time our wrapper sees the URL, it's already
`http://localhost:1420/props`. Our original `maybeRewrite()` only
handled URLs starting with `./` or `/`, so absolute URLs passed
through unchanged.

**Fix.** Treat absolute URLs whose origin matches the webview's own
origin as rewrite candidates too. `getSelfOrigin()` returns
`window.location.origin`; any URL whose origin equals that and whose
path matches a chimera API prefix gets rewritten to the sidecar's
`127.0.0.1:<port>` equivalent.

---

## 4. Sticky "Server unavailable" on first load

**Symptom.** After a clean restart, the chat would show "Server
unavailable" until the user clicked Retry, then it'd connect.

**Cause.** Upstream's `serverStore.fetch()` fires on layout
`$effect`, which runs after mount but possibly before
`resolveChimeraSidecar()` completes its `invoke('sidecar_port')`
round-trip. If `chimeraBase` is null at the moment the fetch is
intercepted *and* we don't wait for it, the wrapper falls through
to native fetch with the unrewritten URL → 404 → upstream sticks in
error state.

**Fix.** Two changes:

1. Call `resolveChimeraSidecar()` at module init (not in
   `onMount`) so port resolution starts as early as possible.
2. With § 1's conditional-await fix, chimera-bound fetches that
   arrive before `chimeraBase` is set now queue behind `baseReady`
   and unblock once the port resolves. Combined, the first
   `/props` fetch waits a fraction of a second instead of failing.

---

## Notes for would-be Tauri 2 + heavy-SvelteKit-fork integrators

- If you wrap `globalThis.fetch`, **never** block unconditionally.
  Always check whether the URL is one you actually want to handle
  before awaiting any promise that depends on Rust commands.
- Tauri 2's IPC is `fetch`-based on macOS. Anything that breaks
  `fetch` breaks IPC silently.
- Don't trust devtools to surface IPC errors — they manifest as
  pending Promises with no log output. Add a custom command (we
  use `ping`) early in development so you can sanity-check IPC
  independent of the rest of your app.
- The minimum-reproducible-test approach is invaluable here: when
  stuck, scaffold a fresh `npm create tauri-app` in a temp dir and
  confirm Tauri itself isn't the problem. That single test (§ 1's
  bisect) saved hours.

## Diagnostic surface left in the code

The verbose logging that was essential during the debugging chain
above is gated behind a debug flag rather than removed — the next
person doing similar work will want it back. Two switches, one per
side of the IPC boundary:

- **Rust side**: set `CHIMERA_DESKTOP_DEBUG=1` in the environment
  before launching (e.g. `CHIMERA_DESKTOP_DEBUG=1 make run`). The
  `src-tauri/src/debug.rs` module reads it once at startup via
  `debug::init()` and the `debug!(...)` macro becomes a no-op when
  unset.
- **JS side**: in devtools console,
  `localStorage.setItem('chimera.debug', '1')` then reload. The
  `chdbg(...)` helper in `src/lib/chimera/debug.ts` checks the flag
  at module load.

A few eprintlns stay unconditional because they're either errors or
high-signal first-launch confirmations: model-path resolution,
`sidecar healthy on port N`, `terminated code=N`, the `sidecar
spawn failed:` branch, and any unhandled invoke error.

## Adding a chimera-specific feature panel

The shape used for the persisted-chat browser at
`src/routes/chimera/chats/` is the pattern for any chimera-only UI:

1. **Add a route under `src/routes/chimera/<feature>/`.** Reuses
   the root `+layout.svelte` so it inherits the chrome (right rail,
   status bar). Don't add to upstream's `(chat)` or `settings/`
   trees — those are vendored and meant to track upstream.
2. **Fetch via unqualified relative paths** like
   `fetch('/v1/chats?limit=50')`. `chimeraFetch` in
   `src/lib/chimera/sidecar.ts` rewrites them to the sidecar's
   `http://127.0.0.1:<port>` and routes through the Tauri HTTP
   plugin. Never construct an absolute chimera URL by hand — it
   ties the page to whatever port chimera picked at startup.
3. **Pick up the link from `StatusBar.svelte`** if the feature
   deserves a global entrypoint. Otherwise let users hit the route
   directly via the URL bar. Same pattern as the `chats` and
   `diagnostics` links.
4. **Style with scoped CSS in the component**, using
   `var(--background, …)`-style variables to pick up upstream's
   theme tokens with graceful fallbacks for the cases where they
   aren't defined.
5. **No upstream files should need patches** for a sibling route
   under `chimera/`. If you find yourself editing upstream code,
   stop and audit whether the feature really needs to live in
   upstream's tree or if a sibling route would do.
