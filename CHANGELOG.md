# Changelog

All notable changes to chimera-desktop are recorded here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions track [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

### Added

- **Tauri 2 desktop shell** with a SvelteKit frontend forked from
  [llama.cpp `tools/server/webui/`](https://github.com/ggml-org/llama.cpp/tree/master/tools/server/webui)
  at ref `b9119`. The bundled `chimera` binary runs as a sidecar
  child process on a free localhost port picked by Rust at app
  start.
- **chimera-desktop chrome** wraps the upstream chat: a right-side
  tab rail with placeholders for RAG / Audio / Image / Rerank /
  LoRA, and a bottom status bar showing sidecar status, base URL,
  loaded model alias, and links to chats / diagnostics.
- **`X-Chimera-Chat-Id` round-trip** on every `/v1/chat/completions`
  request — closes the persistence-consolidation gap in
  `chimera/docs/dev/webui.md` §5.6. Multi-turn conversations
  consolidate into one persisted chats row instead of one row per
  request. ID mapping is stored in `localStorage` under
  `chimera.chatIds.v1`.
- **Persisted-chat browser** at `/#/chimera/chats` — reads chimera's
  SQLite store via `GET /v1/chats`, debounced FTS5 search via
  `GET /v1/chats/search`, and a read-only detail view at
  `/#/chimera/chats/:id`. Linked from the status bar.
- **Diagnostics page** at `/#/chimera/health` surfacing sidecar
  status, picked port, `/v1/models` JSON, and `/props` excerpt.
  Useful when the chat shows "Server unavailable" — tells you which
  layer is broken. Linked from the status bar.
- **`make` targets** wrapping the npm + cargo + tauri workflow:
  `install`, `sidecar`, `dev`, `run`, `vite-dev`, `build`,
  `tauri-build`, `tauri-build-debug`, `check`, `clean`. `make help`
  prints the lot with auto-detected defaults.
- **Background `/health` probe** in Rust that autonomously flips
  sidecar status `Starting` → `Running` once chimera answers. The
  status bar dot turns from yellow to green without any frontend
  involvement.
- **Adaptive `sidecar_status` polling** in the status bar: 2 s
  while starting / unknown, 10 s once running, stops entirely on
  failed / exited.
- **Diagnostic logging gates** — `CHIMERA_DESKTOP_DEBUG=1` (Rust
  env var) and `localStorage.setItem('chimera.debug', '1')` (JS).
  When off, debug calls are no-ops; when on, the verbose chain
  used during the IPC-debugging saga is fully restored. Critical
  errors and first-launch confirmations stay unconditional.
- **Documentation** —
  [`docs/implementation.md`](docs/implementation.md) for non-obvious
  runtime plumbing (the four real bugs we fixed),
  [`docs/upstream-rebase.md`](docs/upstream-rebase.md) for the
  procedure to re-vendor `llama-ui` on a chimera bump, and
  [`TODO.md`](TODO.md) for prioritized open work.

### Fixed

- **IPC deadlock from unconditional `await baseReady` in the fetch
  wrapper.** Tauri 2's IPC custom protocol on macOS uses `fetch`
  to `ipc://localhost/...`. The original `chimeraFetch` wrapper
  awaited a promise fulfilled by invoke's result before letting
  any fetch through — including invoke's own IPC fetch. Now the
  wait is conditional on the URL actually being chimera-bound;
  `ipc://` and `tauri://` URLs pass straight through.
- **CORS / COEP blocking chimera-bound requests.** Webview origin
  (`http://localhost:1420` in dev, `tauri://localhost` in
  production) differs from the chimera sidecar (`http://127.0.0.1:<port>`).
  Removed upstream's COEP `require-corp` header (it's for Pyodide,
  which chimera-desktop doesn't use) and routed all rewritten
  chimera URLs through `@tauri-apps/plugin-http`'s fetch, which
  goes via Rust's `reqwest` and bypasses webview CORS/COEP.
- **Absolutized `Request` URLs bypassing the rewriter.** Upstream
  constructs `Request` objects, which browsers absolutize against
  the document origin immediately. The rewriter now also rewrites
  absolute URLs whose origin matches the webview's own origin and
  whose path is on the chimera surface.
- **Sticky "Server unavailable" on first load.** Upstream's first
  `/props` fetch fired before the sidecar port was known. Now
  `resolveChimeraSidecar()` runs at module init (not `onMount`),
  and chimera-bound fetches that arrive before the port is set
  queue on a one-shot promise instead of failing.
- **Orphan chimera processes on parent death.** `CommandChild` is
  now held inside a `ChildGuard` with a kill-on-drop impl, and a
  `RunEvent::Exit` hook calls `sidecar::kill()` as a belt-and-
  suspenders cleanup. Hard `SIGKILL` of the Tauri parent still
  leaks the child (only the OS can reap those).
- **Model path resolved against the wrong cwd.** chimera was
  inheriting Tauri's cwd, not the user's shell cwd, so relative
  `-m <path>` arguments failed with exit code 3. Rust now
  canonicalizes against `std::env::current_dir()` and fails loud
  if the file isn't readable, instead of letting chimera exit
  silently after spawn.
- **Theme bleed from diagnostics page.** The diagnostics page used
  to set `:global(body)` styles that persisted across navigation,
  forcing a dark theme on the chat. Now uses scoped styles only
  with CSS-variable fallbacks that pick up upstream's theme
  tokens.
- **Non-chat routes not scrollable.** The upstream `Sidebar.Inset`
  child wrapper was `overflow-hidden`, which prevented our
  diagnostics and chats pages from scrolling. Changed to
  `overflow-auto`; upstream's chat manages its own scrolling and
  is unaffected.
- **`/v1/chats` 404 on the chats page.** chimera's chat-history
  routes only bind when started with `--persist-chats`. Added the
  flag to the spawn args in `src-tauri/src/sidecar.rs`.

### Known issues

- Hard `SIGKILL` of the Tauri parent (`kill -9`, OS crash) still
  leaks the chimera child. Only the OS can reap those.
- Click-to-resume from the persisted-chat detail view back into
  upstream's chat UI is not yet wired. The detail view is
  read-only; reload upstream's `(chat)` route to continue.
- The right-rail panels (RAG / Audio / Image / Rerank / LoRA) are
  stubs — each opens a slide-out naming the `chimera serve` flag
  it would need and links to docs. No live wiring yet.

### Pinned versions

- `llama.cpp` UI source: tag `b9119` (matches chimera 0.2.0's
  `LLAMACPP_VERSION`).
- Tauri runtime: `^2.11`.
- `@tauri-apps/api`: `^2`.
- `@tauri-apps/plugin-{shell,http,opener}`: `^2`.
- Frontend: Svelte `^5.38`, SvelteKit `^2.48`, Vite `^7.2`,
  Tailwind `^4.0`.
