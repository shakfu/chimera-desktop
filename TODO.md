# TODO

Open work for chimera-desktop, roughly in priority order. Move items to
the bottom (or delete) as they ship.

Companion to the architecture / decisions docs:

- [`chimera/docs/dev/chimera-desktop-plan.md`](https://github.com/shakfu/chimera/blob/main/docs/dev/chimera-desktop-plan.md) — full plan; this TODO operates within its scope.
- [`docs/implementation.md`](docs/implementation.md) — non-obvious bits of the runtime plumbing.
- [`docs/upstream-rebase.md`](docs/upstream-rebase.md) — recipe for rebasing the vendored UI.

---

## P0 — quick polish (~1 hour total)

Foot-guns and cosmetic noise from the initial build-up. Cheap to fix
and unblock daily-driver use of the app.

- [ ] **Fix orphan chimera processes on parent death.** `sidecar::kill()`
  only runs on `WindowEvent::Destroyed`; Ctrl-C on `make run` (or any
  hard-kill of the Tauri parent) leaves the chimera child alive. After
  a day of dev runs you accumulate N orphans. Add a `Drop` impl on the
  held `CommandChild` in `src-tauri/src/sidecar.rs` so it SIGKILLs on
  drop. Also consider `signal-hook` SIGTERM/SIGINT handler on the
  Tauri side for clean shutdown.

- [ ] **Gate diagnostic logging behind `CHIMERA_DESKTOP_DEBUG=1`.**
  The aggressive `console.warn('[chimera] ...')` lines in
  `src/lib/chimera/sidecar.ts` and the `eprintln!('[chimera-desktop]
  ...')` lines in `src-tauri/src/{lib,sidecar}.rs` were essential
  during the IPC-debugging chain documented in
  `docs/implementation.md`. Keep them — but make them conditional on
  the env var so a clean `make run` is quiet.

- [ ] **Reduce StatusBar poll rate after Running.** Currently
  `sidecar_status` is polled every 2s indefinitely. Once status is
  `Running`, drop to ~10s. Once it's `Failed` / `Exited`, stop
  polling. `src/lib/chimera/components/StatusBar.svelte`.

---

## P1 — first real feature: persisted-chat left rail

The headline chimera-only differentiator per `chimera-desktop-plan.md`
§6.5. No extra models or services needed (chimera already supports
`--persist-chats`, which `make run` enables).

- [ ] **Read-only chat list.** New `src/lib/chimera/components/ChatsRail.svelte`.
  On mount, fetches `GET /v1/chats?limit=50`, renders a left-side
  column with chat id, first user message preview, message count,
  updated_at. Inject into root `+layout.svelte` to the left of
  upstream's `Sidebar.Root` (or replace it — decide during impl).
- [ ] **Click-to-resume.** Selecting a row fetches `GET /v1/chats/:id`
  and rehydrates the upstream chat view's messages array. May require
  mapping chimera's message shape to upstream's `ConversationsStore`
  entry shape; document the mapping where it lives.
- [ ] **FTS5 search box.** `GET /v1/chats/search?q=…&limit=20` with
  `[word]`-highlighted snippets rendered inline. Search debounced
  ~300ms.
- [ ] **Verify `X-Chimera-Chat-Id` round-trip.** After sending a
  new message, the chat should appear in the rail without page
  reload. Re-fetch `/v1/chats` on chat-completion success, or use
  `localStorage` event hook on `chimera.chatIds.v1`. Confirm a
  multi-turn conversation lands in **one** chats row, not N (this
  is exactly the §5.6 gap the X-Chimera-Chat-Id plumbing was built
  to close).
- [ ] **Document the pattern in `docs/implementation.md`** — adding
  panels that consume chimera-only endpoints is a recurring shape;
  capture it once for the right-rail wirings that follow.

Acceptance: clean restart, send "hi" / "tell me a joke" / "goodbye"
across three messages, see one chats row with three messages in the
rail.

---

## P2 — cross-repo: chimera-side prerequisites for About / DB panels

These are tiny handlers in chimera proper, blocking chimera-desktop's
diagnostics / About expansion. Land them upstream first.

- [ ] **`GET /v1/chimera/info`** endpoint in chimera. Returns the
  data `chimera info` prints (versions, built / loaded / registered
  backends, ggml devices, CPU features) as JSON. Used by
  chimera-desktop's About pane. Doc in chimera's
  `docs/dev/chimera-desktop-plan.md` §3.
- [ ] **`GET /v1/chimera/db`** endpoint in chimera. Returns the data
  `chimera db status` prints (path, file size, row counts per table).
  Used by chimera-desktop's chats panel footer.
- [ ] After both ship in chimera, **bump chimera-desktop's pinned
  sidecar binary** and add an About pane consuming `/v1/chimera/info`
  + a chats-panel DB footer consuming `/v1/chimera/db`.

---

## P3 — right-rail panel wiring

Each panel takes ~half a day end-to-end. Pick the order based on what
model assets you have staged locally. All five panels are stubs in
`src/lib/chimera/components/RightRail.svelte` today — each tab opens
a slide-out naming the `chimera serve` flag and nothing else.

- [ ] **LoRA panel.** Simplest. `GET /lora-adapters` for the list,
  per-row scale slider, `POST /lora-adapters` to apply. Side-by-side
  before/after generation for the same seed makes the effect
  visible. Useful demo.
- [ ] **Rerank panel.** Query textarea + N document textareas + Rerank
  button. `POST /v1/rerank` returns ranked results. Render with
  scores and reordering visualization.
- [ ] **Audio panel.** WAV file upload → `POST /v1/audio/transcriptions`.
  Optional "Translate to English" toggle → `/v1/audio/translations`.
  Defer mic capture until chimera accepts non-WAV formats.
- [ ] **Image panel.** Three tabs (txt2img / img2img / inpaint) →
  `POST /v1/images/{generations,edits,variations}`. Form fields for
  prompt, dimensions, steps, cfg, seed, sampler. LoRA picker pulling
  from `GET /v1/images/lora-adapters` when SD LoRAs are registered.
  Needs SD weights staged in chimera.
- [ ] **RAG panel.** Most ambitious of the five. Combines three
  sub-panels: collections list (`GET /v1/vector_stores`), ingest
  (file upload or text → `POST /v1/vector_stores/:n/files`), search
  (`POST /v1/vector_stores/:n/search`). Plus a fourth "RAG-augmented
  chat" composition tab: search first, inject top-k as system
  context, call `/v1/chat/completions` with citations rendered next
  to the answer. The §6.5 plan calls this the strongest demo of
  chimera-only value.

Each panel should:
- Show "feature disabled, start chimera with `<flag>`" if the
  capability isn't present (probe with a lightweight GET).
- Reuse `src/lib/chimera/sidecar.ts`'s rewriter — never construct
  absolute URLs to chimera directly.
- Be deletable as a single Svelte file so failed experiments are
  cheap to back out.

---

## P4 — first-run UX

Replace the `CHIMERA_DESKTOP_MODEL` env var with a real UI. Currently
`make run` is the only sanctioned entrypoint; a packaged installer
would not have an env var to read.

- [ ] **Model picker on first launch.** Three options: "Browse for a
  `.gguf` file", "Download a default (e.g., Llama-3.2-1B-Instruct)
  from Hugging Face", "Set a models directory and pick from it".
  Store the choice in `localStorage` + (if implemented) chimera's
  DB.
- [ ] **Model selection while running.** Settings → swap to a
  different model. Requires either restarting the sidecar with
  `-m <new>` (simple, slow) or chimera supporting hot model swap
  (out of scope; chimera serve is single-model by design).
- [ ] **Backend detection at first run.** If user is on a GPU
  machine, suggest downloading the CUDA/Metal/etc build of chimera.
  Requires the backend-matrix story (§7 of plan) to be solved first.

---

## P5 — distribution / CI / signing

The plan §5.5 calls out ~2 weeks of infra work before users see
anything. Don't start until P0–P3 are stable.

- [ ] **GitHub Actions CI matrix.** Build the Tauri bundle on
  `{macos-latest, ubuntu-latest, windows-latest}` for every push.
  Smoke test via `cargo check` + `npm run build` + the Playwright
  test plan (P5 below).
- [ ] **Code signing.**
  - macOS: Apple Developer ID Application cert + notarization.
  - Windows: Authenticode cert (EV preferred for SmartScreen).
  - Linux: GPG signing for `.deb` / `.rpm`; AppImage signing.
- [ ] **Installer artifacts.** `.dmg` (macOS), `.msi` + `.exe` NSIS
  (Windows), `.AppImage` + `.deb` + `.rpm` (Linux). All via Tauri's
  bundler.
- [ ] **Auto-update infrastructure.** Tauri updater with signed
  `latest.json` manifest hosted on GitHub Releases.
- [ ] **Per-platform sidecar bundling.** CI produces per-target
  chimera binaries (replacing today's manual `make sidecar`). Plus
  the backend-matrix decision from plan §7 — most likely a thin
  installer + first-run downloader for the right GPU variant.

---

## P6 — testing

- [ ] **Playwright tests against the dev app.** Tauri exposes a
  WebDriver endpoint via `tauri-driver`; Playwright drives the real
  webview. Cover four flows: send a chat message, ingest a document
  into RAG, transcribe an audio file, generate an image.
- [ ] **Headless smoke test in CI.** Linux with Xvfb; macOS/Windows
  native. One pass per OS per PR.
- [ ] **A backend-matrix smoke** — `chimera info`-style probe at
  app startup verifying the bundled binary's loaded backend matches
  the installer variant. (Catches "we shipped the CPU binary
  labeled CUDA" mistakes.)

---

## Outstanding design decisions

Items where the right answer isn't obvious yet — flag here so they
don't get silently decided during impl.

- [ ] **Persisted-chat rail vs upstream's sidebar.** Coexist (4-column
  layout), replace upstream's, or hybrid (upstream's nav header,
  chimera's chats list below)? Decide during P1.
- [ ] **About pane location.** Settings page, dedicated route
  `/#/chimera/about`, or status-bar popover? Lean toward dedicated
  route — easy to deep-link.
- [ ] **`libchimera.a` in-process linkage.** v2-grade work per
  plan §3 (in: spawn sidecar; out-of-scope: link statically).
  Sidecar IPC has not measured as a bottleneck yet; defer until
  there's a reason.
- [ ] **Telemetry.** Plan §15 punts on this as "default to none."
  Confirm before any external release; opt-in crash reporting
  (Sentry) is reasonable, anything beyond is a trust risk for a
  local-first AI app.

---

## Done

- ~~Tauri 2 scaffold + sidecar spawn + free-port pick.~~
- ~~Vendor upstream `tools/server/webui/` @ b9119; merge configs.~~
- ~~chimera-desktop chrome (right rail + status bar).~~
- ~~Diagnostic page at `/#/chimera/health`.~~
- ~~`X-Chimera-Chat-Id` round-trip plumbing.~~
- ~~CORS / COEP fix via `@tauri-apps/plugin-http`.~~
- ~~Fix IPC deadlock from unconditional `await baseReady` in fetch wrapper.~~
- ~~Fix absolutized-URL bypass of the rewriter.~~
- ~~Fix sticky "Server unavailable" by starting port resolution at module init.~~
- ~~Background `/health` probe in Rust to autonomously flip Starting → Running.~~
- ~~Canonicalize model path in Rust before passing to chimera; fail-loud on missing file.~~
- ~~Makefile with `install` / `sidecar` / `dev` / `run` / `build` / `check` / `clean`.~~
- ~~README + `docs/implementation.md` + `docs/upstream-rebase.md`.~~
