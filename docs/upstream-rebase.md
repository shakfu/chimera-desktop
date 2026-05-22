# Upstream rebase recipe

chimera-desktop forks the SvelteKit source of llama.cpp's
`tools/server/webui/` and grafts a small runtime + UI shell around it.
This document is the recipe for re-vendoring upstream when chimera
bumps `LLAMACPP_VERSION` (or when an interesting upstream change lands
between bumps).

Companion docs in the chimera repo:
- [`docs/dev/chimera-desktop-plan.md`](https://github.com/shakfu/chimera/blob/main/docs/dev/chimera-desktop-plan.md)
  §10 — why this discipline exists.
- [`docs/dev/webui.md`](https://github.com/shakfu/chimera/blob/main/docs/dev/webui.md)
  §6.1 — why a fork (rather than iframe) is required for
  X-Chimera-Chat-Id round-trip.

---

## 1. Pin

Current pin: `b9119` (matches chimera 0.2.0's `LLAMACPP_VERSION` in
`scripts/manage.py`).

The pin is implicit — we have no programmatic check that the vendored
source matches the pin. If the upstream chimera HTTP shape diverges
across a bump (a route is renamed, a header is added/removed), the
runtime patch surface here may need to follow.

## 2. What is vendored

Wholesale copy of `tools/server/webui/` from llama.cpp at the pinned
ref, **excluding**:

- `tests/`, `.storybook/`, `vitest-setup-client.ts`,
  `playwright.config.ts` — testing infra not consumed by us.
- `eslint.config.js`, `.prettierrc`, `.prettierignore` — lint config
  not adopted (we may add our own later).
- `scripts/dev.sh`, `scripts/post-build.sh`,
  `scripts/install-git-hooks.sh` — upstream-specific dev workflow
  bound to `tools/server/webui/` path layout.
- `package-lock.json` — regenerated locally to pick up Tauri additions
  and drop unused dev deps.

**Kept**: `src/`, `static/`, `scripts/vite-plugin-llama-cpp-build.ts`
(unused at runtime but kept for grep parity), `svelte.config.js`,
`vite.config.ts`, `tsconfig.json`, `components.json`, `.npmrc`,
`README.md`.

## 3. Patches applied to vendored files

Every patch carries a `chimera-desktop:` comment marker so a future
maintainer can locate them with:

```bash
grep -rn 'chimera-desktop:' src/ svelte.config.js vite.config.ts
```

Current patch set:

### 3.1. `svelte.config.js`

- `adapter` pages/assets changed from `'../public'` to `'build'` to
  match `src-tauri/tauri.conf.json`'s `frontendDist: "../build"`.
- `kit.version.name` renamed from `'llama-server-webui'` to
  `'chimera-desktop'`.
- Everything else (hash router, single-bundle output, relative paths)
  preserved as-is — those settings make Tauri's `tauri://localhost`
  origin work without further patches.

### 3.2. `vite.config.ts`

- `server.port: 1420` + `strictPort: true` added (Tauri expectation).
- `server.proxy` block removed — chimera-desktop's chimera-bound
  fetches go to a dynamic `127.0.0.1:<port>` resolved at runtime via
  the fetch interceptor in `src/lib/chimera/sidecar.ts`. Upstream's
  dev-proxy entries (`/v1`, `/props`, `/models`, `/tools`, `/slots`,
  `/cors-proxy`) are mirrored by the interceptor's
  `CHIMERA_PATH_PREFIXES` list — update both together.
- `clearScreen: false` added (Tauri convention so Rust errors don't
  get scrolled away).
- HMR config tuned for `TAURI_DEV_HOST`.
- Removed: `llamaCppBuildPlugin()` (upstream's `../public` favicon
  inliner — irrelevant for a Tauri bundle), full `test.*` block (we
  don't run upstream's vitest projects), scss `additionalData`
  (unused by our build path).
- Kept: COEP/COOP headers (needed for the Pyodide / Python-in-browser
  feature should we ever wire it).

### 3.3. `src/routes/+layout.svelte`

Four insertions, all marked with `chimera-desktop:` comments:

1. Top of `<script>` — fetch interceptor install:

   ```svelte
   import { installChimeraFetch, resolveChimeraSidecar } from '$lib/chimera/sidecar';
   installChimeraFetch();
   ```

2. Top of `<script>` — chrome component imports:

   ```svelte
   import ChimeraRightRail from '$lib/chimera/components/RightRail.svelte';
   import ChimeraStatusBar from '$lib/chimera/components/StatusBar.svelte';
   ```

3. Inside the existing `onMount(() => { ... })`:

   ```svelte
   resolveChimeraSidecar();
   ```

4. Inside `<Sidebar.Inset>` — replace `{@render children?.()}` with the
   two-level chrome split (horizontal: children + rail; vertical: that
   row + status bar):

   ```svelte
   <Sidebar.Inset class="flex flex-1 flex-col overflow-hidden">
     <div class="flex flex-1 overflow-hidden">
       <div class="flex flex-1 flex-col overflow-hidden">
         {@render children?.()}
       </div>
       <ChimeraRightRail />
     </div>
     <ChimeraStatusBar />
   </Sidebar.Inset>
   ```

The synchronous-install + async-resolve split for fetch is
load-bearing — see the header comment in `src/lib/chimera/sidecar.ts`.
The chrome wrap preserves the outer `Sidebar.Inset` class chain so
upstream's sidebar inset behavior (transitions, mobile collapse) is
not disturbed.

### 3.4. `package.json`

Replaced wholesale rather than patched (the delta is too broad to
track line-by-line):

- Name renamed to `chimera-desktop`.
- Scripts simplified: `dev` -> `vite dev`, `build` -> `vite build`
  (no `bash scripts/dev.sh`, no `post-build.sh`); `tauri` script
  added.
- Added: `@tauri-apps/api`, `@tauri-apps/plugin-opener`,
  `@tauri-apps/plugin-http`, `@tauri-apps/cli`.
- Removed: storybook stack, vitest stack, playwright,
  eslint/prettier toolchains, `http-server` (only used by upstream's
  preview workflow).
- All runtime dependencies preserved (the chat pane needs them).

If upstream adds a new runtime dependency, audit it for inclusion.
If upstream upgrades the framework versions (Svelte 5 → 6, Vite 7 → 8,
Tailwind 4 → 5), expect manual config churn on the next rebase.

### 3.5. Critical: chimeraFetch must not block on baseReady

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

### 3.6. CORS / COEP — why we route through Tauri http

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
| `src/lib/chimera/components/RightRail.svelte` | right tab strip (RAG / Audio / Image / Rerank / LoRA) — stubs in v0, live wiring in future slices |
| `src/lib/chimera/components/StatusBar.svelte` | bottom status bar (sidecar status, port, model alias, diagnostics link) |
| `src/routes/chimera/health/+page.svelte` | sidecar diagnostics page (sibling route at `/#/chimera/health`) |
| `src-tauri/` | Rust shell, sidecar lifecycle, bundle config |
| `README.md`, `LICENSE`, `.gitignore` | repo metadata |
| `docs/` | including this file |

## 5. Rebase procedure

```bash
# 1. Pull upstream at the new pinned ref.
NEW_REF=bXXXX
curl -sL "https://codeload.github.com/ggml-org/llama.cpp/tar.gz/refs/tags/${NEW_REF}" \
  | tar -xz "llama.cpp-${NEW_REF}/tools/server/webui" -C /tmp

# 2. Stash chimera-desktop-only files (see § 4).
git stash push -m "rebase-${NEW_REF}-stash" \
  src/lib/chimera/ src/routes/chimera/ src-tauri/ \
  README.md LICENSE .gitignore docs/ package.json

# 3. Overwrite the vendored surface.
rm -rf src/ static/ scripts/ \
       svelte.config.js vite.config.ts tsconfig.json components.json .npmrc
cp -R /tmp/llama.cpp-${NEW_REF}/tools/server/webui/{src,static,scripts} .
cp /tmp/llama.cpp-${NEW_REF}/tools/server/webui/{svelte.config.js,vite.config.ts,tsconfig.json,components.json,.npmrc} .

# 4. Restore chimera-desktop additions on top.
git stash pop

# 5. Re-apply the §3 patches by hand. The `chimera-desktop:` markers
#    show where they go.

# 6. Refresh dependencies and validate.
rm -rf node_modules package-lock.json .svelte-kit build
npm install
npm run build
( cd src-tauri && cargo check )
npm run tauri dev   # smoke test against a CHIMERA_DESKTOP_MODEL
```

## 6. What to look for during the rebase

In rough order of "most likely to bite":

1. **`/v1/chat/completions` request shape changes** — if upstream
   moves to a new `/v1/responses`-style endpoint by default, the
   `isChatCompletionsRequest` predicate in `sidecar.ts` needs the
   new URL and the X-Chimera-Chat-Id wiring may need to relocate.
2. **New fetch path prefixes** — diff `src/lib/services/*.ts` for new
   `fetch(` call sites; any new bare-relative path needs an entry in
   `CHIMERA_PATH_PREFIXES`. Update the upstream vite-proxy mirror in
   `vite.config.ts` if it changed too.
3. **Routes added under new path roots** — if upstream adds e.g.
   `routes/admin/`, decide whether to keep, drop, or shell-replace
   that route surface. Our `routes/chimera/` namespace is reserved
   for chimera-desktop additions.
4. **Svelte 5 → 6 / SvelteKit API changes** — the runes syntax
   (`$state`, `$derived`, `$props`, `$effect`) is current. A major
   framework bump may rewrite the layout shape; expect the §3.3
   patches to need re-attachment.
5. **Tailwind major version** — the upstream `vite.config.ts`
   imports `@tailwindcss/vite`. A Tailwind 4 → 5 bump changes plugin
   ergonomics; cross-reference [Tailwind upgrade guide].
6. **New chimera-specific routes worth exposing** — if upstream adds
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
