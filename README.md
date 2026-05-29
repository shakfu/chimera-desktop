# chimera-desktop

A Tauri 2 desktop application that wraps [chimera](https://github.com/shakfu/chimera) — bundling the static `chimera` binary as a sidecar process and exposing chimera's full surface (LLM, audio, image, RAG, persistent chat history) through an integrated UI.

The UI is a fork of [llama.cpp's `tools/server/webui/`](https://github.com/ggml-org/llama.cpp/tree/master/tools/server/webui) (pinned to `b9119`), grafted onto a thin Tauri Rust shell that owns the chimera sidecar lifecycle and a small runtime patch layer that:
- Rewrites the upstream UI's relative API calls (`./v1/...`, `./props`, ...) to the chimera sidecar's dynamic localhost port.
- Routes chimera-bound requests through `@tauri-apps/plugin-http` (Rust's `reqwest`) so they bypass the webview's CORS / COEP enforcement.
- Adds `X-Chimera-Chat-Id` round-trip on chat completions so multi-turn conversations consolidate into one persisted chat row instead of one row per request (closes the gap called out in [`chimera/docs/dev/webui.md`](https://github.com/shakfu/chimera/blob/main/docs/dev/webui.md) §5.6).
- Wraps the upstream chat surface in a chimera-desktop chrome (right tab rail + bottom status bar) so chimera-specific surfaces have a home alongside the chat.

Companion design docs in the chimera repo:
- [`docs/dev/chimera-desktop-plan.md`](https://github.com/shakfu/chimera/blob/main/docs/dev/chimera-desktop-plan.md) — full architecture, packager decision, distribution plan.
- [`docs/dev/webui.md`](https://github.com/shakfu/chimera/blob/main/docs/dev/webui.md) — history of the in-tree webui experiments and why a separate downstream app owns deep integration.

## Status

End-to-end working: chat against a bundled chimera sidecar, with a chimera-specific status bar and right-rail chrome around the vendored upstream chat. Streamed responses, conversation persistence with chimera-side consolidation, settings, MCP servers — all functional.

### Working

- Tauri 2 shell with the vendored upstream SvelteKit UI as the frontend.
- Bundled `chimera` binary spawned via `tauri-plugin-shell` on app launch, on a free localhost port picked by Rust.
- Background Rust thread probes `/health` and flips the sidecar status `Starting` → `Running` autonomously; webview reads the state via Tauri commands.
- Webview installs a `globalThis.fetch` interceptor at module init that rewrites chimera-bound URLs (relative or origin-matching absolute) to the sidecar port, and routes them through the Tauri HTTP plugin to bypass CORS.
- Chat completions carry the `X-Chimera-Chat-Id` header, mapping upstream's conversation id ↔ chimera's chats row id in `localStorage`.
- Right tab rail with functional RAG, Audio, Image, and Rerank panels — each lights up when the sidecar is started with the matching model (see § Models directory); the LoRA tab is still a stub naming the `chimera serve` flag it needs.
- Bottom status bar: sidecar dot, base URL, loaded model alias, diagnostics link.
- Sidecar killed on window destroy (caveat: parent-process death via Ctrl-C can leave orphans; see § Known issues).
- Diagnostics page at `/#/chimera/health` (sidecar status, port, `/v1/models`, `/props` excerpt).
- Frontend test suite (`make test`): a Node unit project (vitest) covering the chimera API clients and the `globalThis.fetch` rewriter, plus a jsdom + Testing Library project for component tests.

### Not yet here

- LoRA panel wiring — the LoRA tab is still a stub; live `GET`/`POST /lora-adapters` hot-swap UI is future work. (The RAG, Audio, Image, and Rerank panels are now wired.)
- Persisted-chat left rail (`chimera-desktop-plan.md` §6.3 has a fourth column for `/v1/chats*`; upstream's own conversation sidebar is what's there now).
- First-run model picker UX (model path comes from the `CHIMERA_DESKTOP_MODEL` env var; `make run` handles this for you).
- Installer / code-signing / auto-update.
- CI matrix.
- `libchimera.a` in-process linkage (sidecar process only for now).

### Known issues

- **Orphan chimera processes on parent crash.** `sidecar::kill()` runs on `WindowEvent::Destroyed` only; a hard kill of `make run` (Ctrl-C, panic) leaves the chimera child alive. Workaround: `pkill chimera` if you suspect orphans. Real fix needs `Drop` impl on the held `CommandChild`.

## Prerequisites

- macOS arm64 host (only target wired today — see § Sidecar binary).
- [Rust toolchain](https://rustup.rs/) — tested with `cargo 1.95`.
- Node 22+ and npm 10+.
- A `.gguf` model file on disk (any chimera-compatible LLM).
- A built `chimera` binary — see § Sidecar binary.

## Fresh-clone quickstart

```bash
# 1. Stage the chimera sidecar binary.
#    Either fetch the prebuilt release (no local chimera checkout needed)...
make sidecar-release
#    ...or copy from a local chimera build (~/projects/personal/chimera built):
# make sidecar

# 2. Symlink a models directory so `make run` can find a default model.
ln -s ~/projects/personal/cyllama/models models

# 3. Install JS dependencies.
make install

# 4. Launch the app — exports CHIMERA_DESKTOP_MODEL automatically.
make run
```

The window opens to the vendored chat pane wrapped in the chimera-desktop chrome. The chimera sidecar starts in the background; first chat completion blocks briefly while the model loads, then streams.

## Makefile targets

`make help` prints the full list with auto-detected defaults. Highlights:

| target | what it does |
|---|---|
| `make install` | `npm install` |
| `make sidecar` | copy `$CHIMERA_BUILD` (default: sibling chimera repo) into `src-tauri/binaries/chimera-<triple>` |
| `make sidecar-from FROM=/path/to/chimera` | same, from an arbitrary path |
| `make sidecar-release` | download + stage the prebuilt chimera `$CHIMERA_VERSION` release binary (needs `gh`; no local build) |
| `make dev` | full app: exports `CHIMERA_DESKTOP_MODEL=$(abspath $MODEL)` (verifies it exists), then `npm run tauri dev` |
| `make run` | alias for `make dev` |
| `make vite-dev` | frontend only, no Tauri shell (fast UI iteration) |
| `make build` | static vite bundle to `build/` |
| `make tauri-build` | full Tauri release bundle (slow, signed) |
| `make tauri-build-debug` | Tauri debug bundle (faster, unsigned) |
| `make check` | svelte-check + cargo check |
| `make test` | frontend unit + component tests (vitest) |
| `make clean` | wipes `node_modules`, build artifacts, staged binaries |

Override variables on the command line:

- `make MODEL=/abs/path/Qwen3-4B-Q8_0.gguf run` — different model for one run.
- `make AUDIO_MODEL=… IMAGE_MODEL=… RAG_MODEL=… RERANK_MODEL=… dev` — point the optional Audio / Image / RAG / Rerank panels at local models. Each route is enabled only when its file exists, so unset/missing ones simply stay off; `make help` prints the defaults (all under `models/`).
- `make CHIMERA_BUILD=/path/to/chimera-cuda sidecar` — stage a non-default chimera build.
- `make CHIMERA_VERSION=0.2.3 sidecar-release` — fetch a different release version.
- `make TARGET_TRIPLE=x86_64-apple-darwin sidecar` — override the auto-detected host triple (rare; useful for cross-bundling experiments).

## Sidecar binary

The chimera sidecar is **not committed** to this repo. Two ways to stage it into `src-tauri/binaries/chimera-<TARGET_TRIPLE>`:

- `make sidecar-release` — download the prebuilt, portable (OpenSSL-free) binary from the [chimera GitHub release](https://github.com/shakfu/chimera/releases) pinned by `CHIMERA_VERSION` (default `0.2.3`). Needs the `gh` CLI; no local chimera checkout. This is the recommended path and the one the distribution model targets.
- `make sidecar` — copy from a local build at `$CHIMERA_BUILD` (default `~/projects/personal/chimera/build/chimera`). Use this when iterating on chimera itself.

Tauri's `bundle.externalBin` convention appends the host target triple to the configured base name (`binaries/chimera`), which is why the file on disk must include the suffix.

**Minimum chimera version: 0.2.1.** chimera-desktop's graceful-shutdown path POSTs to `/v1/chimera/shutdown`, which first appeared in chimera 0.2.1. Against an older sidecar that endpoint 404s and shutdown falls through to SIGKILL (functional, but ungraceful). 0.2.3 is the verified-compatible release: the spawn args (`serve --host --port -m --persist-chats`) and the `/health`, `/v1/models`, `/props`, `/v1/chats*`, and `X-Chimera-Chat-Id` chat-completion round-trip all work unchanged. (0.2.3 only bumps the bundled llama.cpp / stable-diffusion.cpp engines, reworks webui embedding internals, and adds Python bindings -- no change to the HTTP API or spawn contract chimera-desktop depends on.)

Per-platform builds would stage:
- `chimera-aarch64-apple-darwin`
- `chimera-x86_64-apple-darwin`
- `chimera-x86_64-unknown-linux-gnu`
- `chimera-aarch64-unknown-linux-gnu`
- `chimera-x86_64-pc-windows-msvc.exe`

Per-platform CI builds + a CDN-hosted backend matrix is the eventual plan (chimera-desktop-plan.md §7); the local-copy step is v0 scaffolding only.

## Models directory

`make run` looks for `models/<filename>.gguf` relative to the repo root. The convention is to symlink a shared model store (e.g., the one in a sibling cyllama checkout) so `make run` works without per-machine path edits:

```bash
ln -s ~/projects/personal/cyllama/models models
```

`models` and `models/*` are gitignored — the symlink target is never tracked.

The optional right-rail panels are driven by their own models in the same directory, each enabled only when the file is present (defaults printed by `make help`, override with the matching make variable):

| panel | default `models/…` file | make variable | `chimera serve` flag |
|---|---|---|---|
| Audio | `ggml-base.en.bin` | `AUDIO_MODEL` | `--enable-audio` |
| Image | `sd_xl_turbo_1.0.q8_0.gguf` | `IMAGE_MODEL` | `--enable-image` |
| RAG | `bge-small-en-v1.5-q8_0.gguf` | `RAG_MODEL` | `--enable-rag` |
| Rerank | `bge-reranker-base-q8_0.gguf` | `RERANK_MODEL` | `--reranking` |

A missing file just leaves that panel showing its "route not enabled" state; chat works regardless.

## Diagnostics

- `/#/chimera/health` — sidecar status, picked port, `/v1/models` JSON, `/props` excerpt.
- Status bar at the bottom of every screen — sidecar dot, base URL, loaded model alias.

## Implementation notes

Getting Tauri 2 working on top of a heavily-configured upstream SvelteKit fork surfaced four non-obvious bugs (fetch-wrapping deadlocking Tauri IPC, CORS/COEP blocking cross-origin requests, upstream's `Request` objects bypassing our rewriter, sticky first-load errors). Each is documented with symptom / cause / fix in [`docs/implementation.md`](docs/implementation.md), along with general guidance for anyone forking this for a similar setup.

## Project layout

```
Makefile              Wraps npm + cargo + tauri commands. `make help` lists targets.
src/                  Vendored SvelteKit frontend (fork of llama.cpp/tools/server/webui @ b9119)
  app.html, app.css     Upstream entry + global styles
  routes/
    +layout.svelte      Upstream root layout (patched: see docs/upstream-rebase.md §3.3)
    (chat)/             Upstream chat route group (URL = `/`)
    settings/           Upstream settings
    mcp-servers/        Upstream MCP server panel
    chimera/health/     chimera-desktop diagnostics (sibling, not vendored)
  lib/
    chimera/
      sidecar.ts          Fetch interceptor + X-Chimera-Chat-Id + Tauri-http routing
      state.svelte.ts     Shell-owned UI state ($state store)
      components/
        RightRail.svelte    Vertical tab strip + slide-out panel
        StatusBar.svelte    Bottom strip: sidecar status, port, model
    components/, services/, stores/, ...  Vendored from upstream
src-tauri/            Rust + Tauri shell (chimera-desktop)
  src/
    main.rs               Entry
    lib.rs                App builder, plugin registration, lifecycle wiring
    sidecar.rs            chimera spawn / kill / status commands + health probe
  binaries/               Staged chimera binaries (gitignored)
  capabilities/
    default.json          Shell sidecar + HTTP plugin permissions
  tauri.conf.json         Window, bundler, externalBin
  Cargo.toml
docs/
  implementation.md     The non-obvious bits of the runtime plumbing (fetch wrapping, IPC, CORS, etc.)
  upstream-rebase.md    Recipe for rebasing the vendored webui on the next llama.cpp bump
svelte.config.js      Patched from upstream (build output dir)
vite.config.ts        Patched from upstream (Tauri dev port, dropped proxy + COEP)
```

## Rebasing the vendored UI

See [`docs/upstream-rebase.md`](docs/upstream-rebase.md). Every chimera-desktop patch on top of upstream files carries a `chimera-desktop:` comment marker so it's grep-locatable:

```bash
grep -rn 'chimera-desktop:' src/ svelte.config.js vite.config.ts
```

## License

MIT. See [LICENSE](LICENSE). Vendored upstream code in `src/` retains its upstream MIT license terms.
