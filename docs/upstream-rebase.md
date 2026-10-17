# Upstream rebase recipe

chimera-desktop forks the SvelteKit source of llama.cpp's web UI
(`tools/ui/`; `tools/server/webui/` at `b9119` and earlier) and grafts a
small runtime + UI shell around it. This document is the recipe for
re-vendoring upstream when chimera bumps `LLAMACPP_VERSION`.

Companion docs in the chimera repo:
- [`docs/dev/chimera-desktop-plan.md`](https://github.com/shakfu/chimera/blob/main/docs/dev/chimera-desktop-plan.md)
  §10 — why this discipline exists.
- [`docs/dev/webui.md`](https://github.com/shakfu/chimera/blob/main/docs/dev/webui.md)
  §6.1 — why a fork (rather than iframe) is required for
  X-Chimera-Chat-Id round-trip.

---

## 1. Pin

Current pin: `b11669`, matching chimera 0.7.0's `LLAMACPP_VERSION`.

The pin is implicit: nothing checks that the vendored source matches it.

## 2. What is vendored

Copy of `tools/ui/` at the pinned ref, **excluding**:

- `tests/`, `.storybook/`, `playwright.config.ts`,
  `vitest-setup-client.ts` — upstream test infra; we run
  `vitest.config.ts`.
- `eslint.config.js`, `.prettierrc`, `.prettierignore` — lint config.
- `CMakeLists.txt`, `sources.cmake`, `ui.cpp.in`, `ui.h.in` — embed the
  UI into llama-server.
- `scripts/dev.sh`, `scripts/git-hooks/` — upstream dev workflow.
- `.env.example`, `README.md`.

**Kept**: `src/`, `static/`, `scripts/vite-plugin-*.ts`,
`scripts/favicon-colorize.ts`, `scripts/make-icons-circular.js`,
`svelte.config.js`, `vite.config.ts`, `tsconfig.json`,
`components.json`, `.npmrc`, `pwa-assets*.config.ts`,
`vitest.shims.d.ts`, and upstream's `package-lock.json` as the
starting lockfile (see § 3.5).

`.npmrc` sets `ignore-scripts=true`, so `npm install` does not run
`prepare`. Run `npx svelte-kit sync` once after a clean install, or the
build fails on a missing `.svelte-kit/tsconfig.json`.

## 3. Patches applied to vendored files

Every patch carries a `chimera-desktop:` comment marker:

```bash
grep -rn 'chimera-desktop:' src/ svelte.config.js vite.config.ts
```

### 3.1. `svelte.config.js`

`outDir` is `'build'`, matching `tauri.conf.json`'s
`frontendDist: "../build"`. Upstream reads `LLAMA_UI_OUT_DIR` from its
CMake staging, else `./dist`. Keep the hash router, relative paths and
`bundleStrategy: 'single'`: without single-bundle output, SvelteKit's
SSR pass evaluates `pdfjs-dist` in Node and fails on `DOMMatrix`.

### 3.2. `vite.config.ts`

The file header lists the deltas. The non-obvious one: `SvelteKitPWA`
gets `disable: true` *and* `devOptions: { enabled: false }`. `disable`
alone still registers `dev-sw.js` in dev. With both, the
`virtual:pwa-*` modules upstream imports resolve to no-op stubs.

`server.proxy` is removed. Its prefixes are mirrored by
`CHIMERA_PATH_PREFIXES` in `src/lib/chimera/sidecar.ts`; update both
together.

### 3.3. `src/routes/+layout.svelte`

- Top of `<script>`: `installChimeraFetch()` and
  `resolveChimeraSidecar()`, before upstream's `initStores()` issues
  its first fetch. Then the `RightRail` / `StatusBar` imports.
- After the `children` column: the rail in a `sticky top-0` wrapper,
  then a spacer of `--chimera-statusbar-h` and `<ChimeraStatusBar />`.

From b11429 upstream scrolls the document (`use-chat-screen-scroll`
binds `document.documentElement`) and anchors its chrome to the
viewport with `100dvh` heights and `sticky`/`fixed` bottoms. So the
status bar is `position: fixed`, and the sites below subtract its
height (`--chimera-statusbar-h`, defined in `StatusBar.svelte`).
Wrapping the app in an overflow container instead would break
auto-scroll and clip the sidebar.

### 3.4. Status bar offsets and startup splash

- `SidebarNavigation.svelte`: `md:h-[calc(100dvh-1.125rem)]` and the
  default expanded mobile height subtract `--chimera-statusbar-h`.
- `ChatScreen.svelte`: the `min-h` classes and the chat form's
  `bottom-*` offsets subtract it.
- `ChatScreen.svelte`, startup splash: chimera binds its listener only
  after the model loads, so `/props` fails fast while the sidecar is
  `starting`. Until the sidecar settles, `showLoadingSplash` shows
  `ServerLoadingSplash` with a startup message instead of the
  server-error alert.

### 3.5. `package.json` and `package-lock.json`

`package.json` is replaced wholesale. Vendored dependencies take
upstream's exact pins. The Tauri packages and the test stack
(`vitest`, `jsdom`, `@testing-library/*`) are added. The storybook,
eslint, prettier, playwright and `http-server` stacks are dropped.

The four `@tauri-apps/*` npm packages are pinned to the
major.minor of the crates in `src-tauri/Cargo.lock`. `tauri dev`
reports a mismatch otherwise.

Start from upstream's `package-lock.json` rather than a fresh resolve.
A fresh resolve at b11429 pulled `esrap` 2.4.0 under Svelte 5.56.1,
which leaves the `?` of optional parameters in compiled output
(`function f(a?)`); rollup then fails to parse the first `.svelte`
file with one. Upstream's lock resolves `esrap` 2.2.11.

### 3.6. `src/lib/services/chat.service.ts`

`handleStreamResponse` ends the stream on a `data: {"error": ...}`
event and throws the server's message, which the existing `catch`
passes to `onError`. Upstream ignores the event, sees the stream end
without `[DONE]`, and resumes. The resume returns no bytes, so the UI
showed "Stream resume produced no new bytes" instead of the error.
`src/lib/chimera/stream-error.spec.ts` covers it. Drop the patch if
upstream handles the event.

### 3.7. `src/app.html` and the PWA refresh alert

- `app.html`: a head script adds the missing `/` to the start URL with
  `history.replaceState`. WebKit loads `tauri://localhost` with no path.
  For that non-special scheme `new URL(location.href).pathname` is `""`
  while `location.pathname` is `"/"`. SvelteKit's hash router compares
  the two (`is_external_url`), calls the start URL external, and does a
  full navigation to it; the production window reloads about every
  150 ms and stays blank. Dev (`http://localhost:1420`) and Windows
  (`http://tauri.localhost`) use special schemes and are unaffected.
- `+layout.svelte`: `PwaRefreshAlert` is not rendered. `use-pwa`
  compares the build version with the one in `localStorage`; in a
  bundled app a change means the app was already upgraded, so the
  alert asked for a reload after every upgrade.

### 3.8. Patches dropped at b11429

- `models.service.ts` `parseModelId`: upstream now strips the
  directory and weight extension itself (`normalizeModelName`).
  `src/lib/chimera/model-id.spec.ts` still asserts the result.
- `styles/katex-custom.scss`: upstream removed the file.

### 3.9. Critical: chimeraFetch must not block on baseReady

`src/lib/chimera/sidecar.ts` MUST NOT `await baseReady` (or any other
promise gated on Rust command results) inside the wrapped `fetch`. The
reason is non-obvious: **Tauri 2's IPC custom protocol on macOS uses
`fetch` to `ipc://localhost/...`**. If our wrapper blocks every fetch
on a promise that itself depends on Rust commands (which need IPC,
which needs fetch), the whole IPC pipeline deadlocks silently. The
symptom is: every `invoke()` call returns a Promise that stays
pending forever, with no error logged. Hours-to-find.

`isAbsolute()` must also include `ipc://` and `tauri://` schemes (not
just `http(s)://`) so these custom-protocol URLs pass straight through
to native fetch without our path-detection logic touching them.

If you ever reintroduce blocking behavior in `chimeraFetch`, the chat
UI will show "Connecting to Server" forever and devtools will show
`__TAURI_INTERNALS__.invoke('ping')` promises pending.

### 3.10. CORS / COEP — why we route through Tauri http

chimera does not send `Access-Control-Allow-Origin` headers (no
`--cors` flag), and upstream's `vite.config.ts` keeps
`Cross-Origin-Embedder-Policy: require-corp` set on the dev server.
Together those make the webview's native `fetch` unable to talk to
chimera at a different origin. The fix routes chimera-bound requests
through `@tauri-apps/plugin-http`'s `fetch`, which goes via Rust's
`reqwest` and is not subject to webview CORS / COEP. Non-chimera
URLs (HMR, data, blob) stay on the original browser fetch.

This lives entirely in `src/lib/chimera/sidecar.ts`'s `chimeraFetch`
implementation; no upstream-file patch needed. If chimera ever
sprouts a `--cors` flag, the Tauri http detour can be removed.

## 4. chimera-desktop-only files (not vendored)

Live alongside the vendored tree; not part of any rebase merge.

| Path | Role |
|------|------|
| `src/lib/chimera/sidecar.ts` | fetch interceptor + X-Chimera-Chat-Id wiring + Tauri-http routing |
| `src/lib/chimera/state.svelte.ts` | shell-owned UI state (active panel, sidecar status mirror, loaded model) |
| `src/lib/chimera/model-name.ts` | display name for chimera's path-shaped model ids, used by the status bar |
| `src/lib/chimera/components/RightRail.svelte` | right tab strip (RAG / Audio / Image / Rerank / LoRA) — stubs in v0, live wiring in future slices |
| `src/lib/chimera/components/StatusBar.svelte` | bottom status bar (sidecar status, port, model alias, diagnostics link) |
| `src/routes/chimera/` | chats, health and about pages (`/#/chimera/*`) |
| `src/test/`, `vitest.config.ts` | vitest setup and `$app/*` stubs for the jsdom project |
| `src-tauri/` | Rust shell, sidecar lifecycle, bundle config |
| `README.md`, `LICENSE`, `.gitignore` | repo metadata |
| `docs/` | including this file |

## 5. Rebase procedure

Start from a clean, committed tree; step 3 restores the
chimera-desktop files from `HEAD`.

```bash
# 1. Fetch upstream at the new ref.
NEW_REF=bXXXXX
UP=$(mktemp -d)
curl -sL "https://codeload.github.com/ggml-org/llama.cpp/tar.gz/refs/tags/${NEW_REF}" \
  | tar -xz -C "$UP" "llama.cpp-${NEW_REF}/tools/ui"
U="$UP/llama.cpp-${NEW_REF}/tools/ui"

# 2. Overwrite the vendored surface (see § 2).
rm -rf src static scripts svelte.config.js vite.config.ts tsconfig.json \
       components.json .npmrc pwa-assets*.config.ts vitest.shims.d.ts
cp -R "$U"/{src,static} .
mkdir scripts && cp "$U"/scripts/{vite-plugin-*.ts,favicon-colorize.ts,make-icons-circular.js} scripts/
cp "$U"/{svelte.config.js,vite.config.ts,tsconfig.json,components.json,.npmrc} .
cp "$U"/{pwa-assets.config.ts,pwa-assets-dark.config.ts,vitest.shims.d.ts} .

# 3. Restore chimera-desktop-only files (see § 4).
git checkout -- src/lib/chimera src/routes/chimera src/test

# 4. Re-apply the § 3 patches. `git diff HEAD -- <file>` shows the old
#    patch against each vendored file.

# 5. Dependencies: merge package.json by hand (§ 3.5), seed the lock.
cp "$U"/package-lock.json .
rm -rf node_modules .svelte-kit build
npm install && npx svelte-kit sync

# 6. Validate.
make test && npm run check && npm run build
( cd src-tauri && cargo test )
make dev    # send a chat; watch for in-stream errors (§ 6, item 3)
make tauri-build
CHIMERA_DESKTOP_MODEL=$PWD/models/<model>.gguf ./src-tauri/target/release/chimera-desktop
```

When upstream's change is small, merging its diff keeps the patches in
place instead of re-applying them. This was done at `b11669`:

```bash
# Upstream trees at the old and new pins in $A and $B.
# Files changed upstream that carry no patch: copy (or delete) from $B.
# Patched files: three-way merge, then resolve by hand.
git merge-file <file> "$A/<file>" "$B/<file>"
```

Run the release binary, not only `make dev`. Production serves the
bundle from `tauri://localhost`, a non-special scheme, and bugs that
depend on it (§ 3.7) do not reproduce in dev.

## 6. What to look for during the rebase

In rough order of "most likely to bite":

1. **Patches that apply but do nothing.** Upstream rewrote the root
   layout, the stores and the scroll model between `b9119` and
   `b11429`. Re-check each § 3 patch site by reading it, not by
   searching for its marker.

2. **`/v1/chat/completions` request shape changes** — the
   X-Chimera-Chat-Id wiring in `sidecar.ts` keys on upstream's
   conversation id. At `b11429` and `b11669` that is the `X-Conversation-Id` header
   (`<conv>[::<model>]`), sent on streaming requests only. `b9119` sent
   no id at all, so the wiring never fired before this rebase. If
   upstream moves the id or the endpoint, follow it.
3. **In-stream server errors.** If "Stream resume produced no new
   bytes" reappears, the § 3.6 patch was lost. Read the raw SSE with
   curl to see the server's error.
4. **New fetch path prefixes** — diff `src/lib/services/*.ts` for new
   `fetch(` call sites; any new bare-relative path needs an entry in
   `CHIMERA_PATH_PREFIXES`. Update the upstream vite-proxy mirror in
   `vite.config.ts` if it changed too.
5. **Routes added under new path roots** — if upstream adds e.g.
   `routes/admin/`, decide whether to keep, drop, or shell-replace
   that route surface. Our `routes/chimera/` namespace is reserved
   for chimera-desktop additions.
6. **Svelte 5 → 6 / SvelteKit API changes** — the runes syntax
   (`$state`, `$derived`, `$props`, `$effect`) is current. A major
   framework bump may rewrite the layout shape; expect the §3.3
   patches to need re-attachment.
7. **Tailwind major version** — the upstream `vite.config.ts`
   imports `@tailwindcss/vite`. A Tailwind 4 → 5 bump changes plugin
   ergonomics; cross-reference [Tailwind upgrade guide].
8. **New chimera-specific routes worth exposing** — if upstream adds
   surfaces we want (e.g., a model-loader panel), evaluate whether to
   vendor or shell-replace. Default to vendor; revisit only when the
   upstream component blocks a chimera-only feature.

## 7. What the rebase does NOT cover

- **chimera HTTP route drift** — if chimera renames a route between
  versions, that's a chimera bump issue, not a webui bump issue.
  The pin-check infrastructure in chimera
  (`src/chimera/chimera_pin_check.cpp`) defends the upstream
  llama.cpp shape but not the chimera-specific routes.
- **Tauri version bumps** — driven by `src-tauri/Cargo.toml` and
  `package.json`; orthogonal to upstream webui rebases.
