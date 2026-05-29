# Changelog

All notable changes to chimera-desktop are recorded here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions track [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-05-29

### Added

- **Audio panel (functional speech-to-text).** The right-rail Audio
  tab is now wired end-to-end instead of a stub: pick a local audio
  file and transcribe it, or toggle **Translate to English**, against
  the sidecar's OpenAI-compatible `/v1/audio/transcriptions` and
  `/v1/audio/translations` routes. Shows the transcript with
  duration / segment count, a copy button, and loading / error /
  not-enabled states. Files upload via the existing fetch wrapper
  (multipart `FormData` through `@tauri-apps/plugin-http`, bypassing
  the webview CORS/COEP). New `src/lib/chimera/audio.ts` service and
  `AudioPanel.svelte`.
- **Image panel (functional text-to-image).** The right-rail Image
  tab is wired to the sidecar's `/v1/images/generations` route: a
  prompt + optional negative prompt, size / steps / CFG-scale / seed
  controls (defaults tuned for the few-step turbo models), and inline
  rendering of the resulting PNG(s) with a per-image download button,
  plus loading / error / not-enabled states. New
  `src/lib/chimera/image.ts` service and `ImagePanel.svelte`.
- **RAG panel (functional vector stores).** The right-rail RAG tab is
  wired to the sidecar's `/v1/vector_stores/*` routes: create / select /
  delete collections, ingest text (with an optional source label) or a
  file (multipart upload, chunked + embedded server-side), and run
  hybrid / semantic / lexical search with a configurable top-k. Results
  show source, score, and chunk text. New `src/lib/chimera/rag.ts`
  service and `RagPanel.svelte`. (Collection drop uses chimera's
  `POST /:name/delete`, not HTTP DELETE.)
- **Rerank panel (functional cross-encoder reranking).** The
  right-rail Rerank tab is wired to the sidecar's `/v1/rerank` route:
  a query plus a variable list of candidate documents are scored by a
  cross-encoder, then reordered by relevance. Results render with a
  rank badge, a relative score bar (raw cross-encoder logits are
  unbounded and often negative, so the bar is normalized within the
  result set, not treated as a 0–1 probability), the raw score, and a
  "was doc N (+/-K)" reorder indicator, plus loading / error /
  not-enabled states. Because `/v1/rerank` returns results keyed by
  input index and not guaranteed sorted, the client sorts descending
  itself. New `src/lib/chimera/rerank.ts` service and
  `RerankPanel.svelte`. Spawn wiring follows the other modalities:
  `CHIMERA_DESKTOP_RERANK_MODEL` → `--reranking` in `sidecar.rs`, and
  `sidecar_features` now reports a `rerank` flag. A `RERANK_MODEL` make
  variable (default `models/bge-reranker-base-q8_0.gguf`) is passed
  through `make dev` as `CHIMERA_DESKTOP_RERANK_MODEL` only when the
  file exists, so a missing model just leaves the route disabled.
- **Frontend test harness (vitest).** `make test` / `npm test` now run
  a two-project vitest setup: a fast Node **unit** project for
  pure-logic tests (the chimera API clients and the `sidecar.ts` fetch
  rewriter, with `fetch` and the Tauri bridge mocked) and a jsdom
  **svelte** project (`@testing-library/svelte` + `svelteTesting`) for
  component tests. Initial coverage is 52 tests across the rerank /
  RAG / audio / image clients, the `sidecar_features` probe, the fetch
  rewriter (path rewriting, passthrough, `X-Chimera-Chat-Id`
  injection / persistence), and the `RerankPanel` component (render
  states, the query-plus-two-documents gate, and the rerank
  call + results rendering). Tests are split by filename: `*.test.ts`
  (Node) and `*.spec.ts` (jsdom + Svelte).
- **Optional modality routes at spawn time.** `sidecar.rs` enables
  audio (`CHIMERA_DESKTOP_AUDIO_MODEL` → `--enable-audio`), image
  (`CHIMERA_DESKTOP_IMAGE_MODEL` → `--enable-image`), and RAG
  (`CHIMERA_DESKTOP_RAG_MODEL` → `--enable-rag`) via a shared helper:
  when a model env var is set and readable, the matching `serve` flag
  is passed. Each route is optional — an unset or unreadable path logs
  a warning and leaves that route off rather than failing the sidecar.
  The `sidecar_features` Tauri command reports which routes are live
  (the webview can't infer them from `/props`, whose `modalities`
  field describes the chat model's multimodal *inputs*, not the
  standalone audio / image / RAG routes).
- **`AUDIO_MODEL` / `IMAGE_MODEL` / `RAG_MODEL` make variables**
  (defaults `models/ggml-base.en.bin`, `models/sd_xl_turbo_1.0.q8_0.gguf`,
  `models/bge-small-en-v1.5-q8_0.gguf`), passed through `make dev` as
  the corresponding `CHIMERA_DESKTOP_*_MODEL` only when the file
  exists, so a missing model just leaves that route disabled instead
  of breaking the launch.

### Changed

- **Bundled chimera sidecar pinned to 0.2.3** (from 0.2.2). 0.2.3
  bumps the embedded llama.cpp / stable-diffusion.cpp engines and adds
  Python bindings; the HTTP API and spawn contract chimera-desktop
  depends on are unchanged (verified: spawn args plus `/health`,
  `/v1/models`, `/props`, `/v1/chats*`, and the chat round-trip).
- **`make dev` is now the canonical full-app launcher.** It sets
  `CHIMERA_DESKTOP_MODEL` from `MODEL` and verifies the file exists
  before launching — previously `dev` started the Tauri shell with no
  model, so the sidecar always failed and the UI booted to a
  "sidecar failed / Server endpoint not found" screen. `make run` is
  now a backward-compatible alias for `dev`.
- **Right rail restyled to the app's design system.** `RightRail.svelte`
  now uses the Tailwind v4 + shadcn OKLCH theme tokens (`bg-background`,
  `border-border`, `text-muted-foreground`, the `Button` primitive,
  …) instead of the hardcoded dark-theme hex fallbacks that clashed
  with the light theme.
- **Capability-aware right rail.** The rail does a single
  `sidecar_features` fetch, passes the enabled state to each panel
  (no per-panel probing), and shows a small green dot on a tab whose
  backing route is live. Feature detection is centralized in
  `src/lib/chimera/features.ts`.

### Fixed

- **`make check` is clean again.** Removed a redundant
  `@ts-expect-error` directive in `vite.config.ts` (the `process.env`
  access it suppressed now type-checks on its own) and an orphaned
  upstream vitest spec (`parameter-sync.service.spec.ts`) that imported
  a test runner the project did not vendor — both surfaced as
  `svelte-check` errors that failed `make check`.
- **Right-rail panel no longer overlaps the chat.** When a panel
  opened, the chat column kept its full width and the panel (plus
  upstream `ChatScreen`'s `absolute left-4 right-4` empty-state block)
  drew on top of it. The chimera chrome wrapper now uses `min-w-0`
  (so the chat column shrinks to make room for the rail) and
  `relative` (so the absolute empty-state block is confined to the
  chat column instead of resolving against a full-width ancestor).

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
