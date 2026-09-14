# Roadmap

Open work for chimera-desktop, roughly in priority order. Move items to the bottom (or delete) as they ship.

## P1.5 — persisted-chat in-layout rail (deferred from P1)

The route-based chat browser at `/#/chimera/chats` shipped in the P0+P1 slice (read-only list, search, detail view). The remaining deeper integration:

- [ ] **In-layout rail.** Decision still open: a fourth column to the left of upstream's sidebar vs. replacing upstream's `SidebarNavigation` vs. hybrid. The route-browser version is enough for "I want to see my chats" — the in-layout rail is mostly about always-visible discoverability.

- [ ] **Click-to-resume into upstream's chat view.** Currently the detail view at `/#/chimera/chats/:id` is read-only. "Continue this chat" needs to map chimera's `StoredMessage[]` shape to upstream's `ConversationsStore` entry shape and seed the chat UI with the prior turns. Non-trivial because upstream's store is IndexedDB- backed and assumes its own id space.

- [ ] **Live-update on new message.** Today the list reloads only on page mount. After sending a new message in upstream's chat, navigate-back-to-list shows the new chat. A `localStorage` event listener on `chimera.chatIds.v1` (the X-Chimera-Chat-Id map) could re-fetch in the background.

- [ ] **Verify multi-turn consolidation.** Acceptance test from the original P1: clean restart, send "hi" / "tell me a joke" / "goodbye" across three messages, see **one** chats row with three messages — not three rows.

---

## P2 — cross-repo: chimera-side prerequisites for About / DB panels

These are tiny handlers in chimera proper, blocking chimera-desktop's diagnostics / About expansion. Land them upstream first.

- [ ] **`GET /v1/chimera/info`** endpoint in chimera. Returns the data `chimera info` prints (versions, built / loaded / registered backends, ggml devices, CPU features) as JSON. Used by chimera-desktop's About pane. Doc in chimera's `docs/dev/chimera-desktop-plan.md` §3.

- [ ] **`GET /v1/chimera/db`** endpoint in chimera. Returns the data `chimera db status` prints (path, file size, row counts per table). Used by chimera-desktop's chats panel footer.

- [ ] After both ship in chimera, **bump chimera-desktop's pinned sidecar binary** and add an About pane consuming `/v1/chimera/info`

  + a chats-panel DB footer consuming `/v1/chimera/db`.

---

## P3 — right-rail panel wiring

Each panel takes ~half a day end-to-end. Pick the order based on what model assets you have staged locally. All five panels are stubs in `src/lib/chimera/components/RightRail.svelte` today — each tab opens a slide-out naming the `chimera serve` flag and nothing else.

- [ ] **LoRA panel.** Simplest. `GET /lora-adapters` for the list, per-row scale slider, `POST /lora-adapters` to apply. Side-by-side before/after generation for the same seed makes the effect visible. Useful demo.

- [x] **Rerank panel.** Query textarea + N document textareas + Rerank button. `POST /v1/rerank` returns ranked results. Render with scores and reordering visualization. Driven by `CHIMERA_DESKTOP_RERANK_MODEL` -> `--reranking`; see `src/lib/chimera/{rerank.ts,components/RerankPanel.svelte}`.

- [ ] **Audio panel.** WAV file upload → `POST /v1/audio/transcriptions`. Optional "Translate to English" toggle → `/v1/audio/translations`. Defer mic capture until chimera accepts non-WAV formats.

- [ ] **Image panel.** Three tabs (txt2img / img2img / inpaint) → `POST /v1/images/{generations,edits,variations}`. Form fields for prompt, dimensions, steps, cfg, seed, sampler. LoRA picker pulling from `GET /v1/images/lora-adapters` when SD LoRAs are registered. Needs SD weights staged in chimera.

- [ ] **RAG panel.** Most ambitious of the five. Combines three sub-panels: collections list (`GET /v1/vector_stores`), ingest (file upload or text → `POST /v1/vector_stores/:n/files`), search (`POST /v1/vector_stores/:n/search`). Plus a fourth "RAG-augmented chat" composition tab: search first, inject top-k as system context, call `/v1/chat/completions` with citations rendered next to the answer. The §6.5 plan calls this the strongest demo of chimera-only value.

Each panel should:
- Show "feature disabled, start chimera with `<flag>`" if the capability isn't present (probe with a lightweight GET).

- Reuse `src/lib/chimera/sidecar.ts`'s rewriter — never construct absolute URLs to chimera directly.

- Be deletable as a single Svelte file so failed experiments are cheap to back out.

---

## P4 — first-run UX

Replace the `CHIMERA_DESKTOP_MODEL` env var with a real UI. Currently `make run` is the only sanctioned entrypoint; a packaged installer would not have an env var to read.

- [ ] **Model picker on first launch.** Three options: "Browse for a `.gguf` file", "Download a default (e.g., Llama-3.2-1B-Instruct) from Hugging Face", "Set a models directory and pick from it". Store the choice in `localStorage` + (if implemented) chimera's DB.

- [ ] **Model selection while running.** Settings → swap to a different model. Requires either restarting the sidecar with `-m <new>` (simple, slow) or chimera supporting hot model swap (out of scope; chimera serve is single-model by design).

- [ ] **Backend detection at first run.** If user is on a GPU machine, suggest downloading the CUDA/Metal/etc build of chimera. Requires the backend-matrix story (§7 of plan) to be solved first.

---

## P5 — distribution / CI / signing

The plan §5.5 calls out ~2 weeks of infra work before users see anything. Don't start until P0–P3 are stable.

- [ ] **GitHub Actions CI matrix.** Build the Tauri bundle on `{macos-latest, ubuntu-latest, windows-latest}` for every push. Smoke test via `cargo check` + `npm run build` + the Playwright test plan (P5 below).

- [ ] **Code signing.**

  - macOS: Apple Developer ID Application cert + notarization.

  - Windows: Authenticode cert (EV preferred for SmartScreen).

  - Linux: GPG signing for `.deb` / `.rpm`; AppImage signing.

- [ ] **Installer artifacts.** `.dmg` (macOS), `.msi` + `.exe` NSIS (Windows), `.AppImage` + `.deb` + `.rpm` (Linux). All via Tauri's bundler.

- [ ] **Auto-update infrastructure.** Tauri updater with signed `latest.json` manifest hosted on GitHub Releases.

- [ ] **Per-platform sidecar bundling.** CI produces per-target chimera binaries (replacing today's manual `make sidecar`). Plus the backend-matrix decision from plan §7 — most likely a thin installer + first-run downloader for the right GPU variant.

---

## P6 — testing

- [ ] **Playwright tests against the dev app.** Tauri exposes a WebDriver endpoint via `tauri-driver`; Playwright drives the real webview. Cover four flows: send a chat message, ingest a document into RAG, transcribe an audio file, generate an image.

- [ ] **Headless smoke test in CI.** Linux with Xvfb; macOS/Windows native. One pass per OS per PR.

- [ ] **A backend-matrix smoke** — `chimera info`-style probe at app startup verifying the bundled binary's loaded backend matches the installer variant. (Catches "we shipped the CPU binary labeled CUDA" mistakes.)

---

## Outstanding design decisions

Items where the right answer isn't obvious yet — flag here so they don't get silently decided during impl.

- [ ] **Persisted-chat rail vs upstream's sidebar.** Coexist (4-column layout), replace upstream's, or hybrid (upstream's nav header, chimera's chats list below)? Decide during P1.

- [ ] **About pane location.** Settings page, dedicated route `/#/chimera/about`, or status-bar popover? Lean toward dedicated route — easy to deep-link.

- [ ] **`libchimera.a` in-process linkage.** v2-grade work per plan §3 (in: spawn sidecar; out-of-scope: link statically). Sidecar IPC has not measured as a bottleneck yet; defer until there's a reason.

- [ ] **Telemetry.** Plan §15 punts on this as "default to none." Confirm before any external release; opt-in crash reporting (Sentry) is reasonable, anything beyond is a trust risk for a local-first AI app.

