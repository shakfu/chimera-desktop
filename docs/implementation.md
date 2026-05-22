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

The aggressive `console.warn('[chimera] ...')` logging in
`src/lib/chimera/sidecar.ts` and the `eprintln!('[chimera-desktop]
...')` lines in `src-tauri/src/sidecar.rs` and `lib.rs` are
deliberately verbose. They were essential during the debugging
chain documented above and are cheap to keep around. If they become
noisy, gate them behind a `CHIMERA_DESKTOP_DEBUG=1` env var rather
than removing them outright — the next person doing this work will
want them back.
