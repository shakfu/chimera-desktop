<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";

  type SidecarStatus =
    | { kind: "NotStarted" }
    | { kind: "Starting" }
    | { kind: "Running" }
    | { kind: "Failed"; detail: string }
    | { kind: "Exited"; detail: number };

  let port = $state<number | null>(null);
  let status = $state<SidecarStatus>({ kind: "NotStarted" });
  let healthOk = $state(false);
  let modelInfo = $state<unknown>(null);
  let props = $state<unknown>(null);
  let error = $state<string | null>(null);

  async function refreshStatus() {
    try {
      const [p, s] = await Promise.all([
        invoke<number | null>("sidecar_port"),
        invoke<SidecarStatus>("sidecar_status"),
      ]);
      port = p;
      status = s;
    } catch (e) {
      error = `tauri command failed: ${e}`;
    }
  }

  async function probeHealth(p: number): Promise<boolean> {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/health`);
      return r.ok;
    } catch {
      return false;
    }
  }

  async function fetchModelInfo(p: number) {
    try {
      const [models, propsResp] = await Promise.all([
        fetch(`http://127.0.0.1:${p}/v1/models`).then((r) => r.json()),
        fetch(`http://127.0.0.1:${p}/props`).then((r) => r.json()),
      ]);
      modelInfo = models;
      props = propsResp;
    } catch (e) {
      error = `failed to fetch model info: ${e}`;
    }
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 300 && !cancelled; i++) {
        await refreshStatus();
        if (status.kind === "Failed" || status.kind === "Exited") return;
        if (port !== null && (await probeHealth(port))) {
          healthOk = true;
          await invoke("sidecar_mark_ready");
          await refreshStatus();
          await fetchModelInfo(port);
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<main>
  <header>
    <h1>chimera-desktop</h1>
    <p class="tagline">first-slice scaffold — proves Tauri shell + sidecar spawn + HTTP round-trip</p>
  </header>

  <section class="card">
    <h2>sidecar</h2>
    <dl>
      <dt>status</dt>
      <dd>
        <span class="badge badge-{status.kind.toLowerCase()}">{status.kind}</span>
        {#if status.kind === "Failed"}<span class="error">— {status.detail}</span>{/if}
        {#if status.kind === "Exited"}<span class="error">— exit code {status.detail}</span>{/if}
      </dd>
      <dt>port</dt>
      <dd>{port ?? "(not assigned yet)"}</dd>
      <dt>health</dt>
      <dd>{healthOk ? "200 OK" : "(awaiting)"}</dd>
    </dl>
  </section>

  {#if modelInfo}
    <section class="card">
      <h2>/v1/models</h2>
      <pre>{JSON.stringify(modelInfo, null, 2)}</pre>
    </section>
  {/if}

  {#if props}
    <section class="card">
      <h2>/props (excerpt)</h2>
      <dl>
        <dt>model alias</dt>
        <dd>{(props as any)?.model_alias ?? "—"}</dd>
        <dt>default temperature</dt>
        <dd>{(props as any)?.default_generation_settings?.temperature ?? "—"}</dd>
        <dt>default top_k</dt>
        <dd>{(props as any)?.default_generation_settings?.top_k ?? "—"}</dd>
        <dt>n_ctx</dt>
        <dd>{(props as any)?.default_generation_settings?.n_ctx ?? "—"}</dd>
      </dl>
    </section>
  {/if}

  {#if status.kind === "Failed"}
    <section class="card hint">
      <h2>setup hint</h2>
      <p>
        The Rust side could not spawn the chimera sidecar. Most common cause: the
        <code>CHIMERA_DESKTOP_MODEL</code> environment variable is unset. Export
        a path to a <code>.gguf</code> model and relaunch:
      </p>
      <pre>export CHIMERA_DESKTOP_MODEL=/path/to/model.gguf
npm run tauri dev</pre>
    </section>
  {/if}

  {#if error}
    <section class="card error-card">
      <h2>error</h2>
      <pre>{error}</pre>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
    background: #1a1a1a;
    color: #e8e8e8;
  }

  main {
    max-width: 880px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }

  header {
    margin-bottom: 2rem;
  }

  h1 {
    margin: 0 0 0.25rem 0;
    font-weight: 600;
    font-size: 1.75rem;
  }

  .tagline {
    margin: 0;
    color: #888;
    font-size: 0.9rem;
  }

  .card {
    background: #242424;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1rem;
  }

  .card h2 {
    margin: 0 0 0.75rem 0;
    font-size: 1rem;
    font-weight: 600;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  dl {
    margin: 0;
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 0.5rem 1rem;
  }

  dt {
    color: #888;
    font-size: 0.9rem;
  }

  dd {
    margin: 0;
    font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.9rem;
  }

  .badge {
    display: inline-block;
    padding: 0.15em 0.6em;
    border-radius: 4px;
    font-size: 0.85em;
    font-weight: 500;
  }
  .badge-notstarted { background: #444; color: #ccc; }
  .badge-starting   { background: #5a4d1f; color: #ffe680; }
  .badge-running    { background: #1f5a3a; color: #80ffb0; }
  .badge-failed     { background: #5a1f1f; color: #ff8080; }
  .badge-exited     { background: #5a1f1f; color: #ff8080; }

  pre {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 0.75rem;
    overflow-x: auto;
    font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.8rem;
    color: #ddd;
  }

  code {
    background: #1a1a1a;
    padding: 0.1em 0.3em;
    border-radius: 3px;
    font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.9em;
  }

  .hint {
    border-color: #5a4d1f;
  }

  .error-card {
    border-color: #5a1f1f;
  }

  .error {
    color: #ff8080;
    margin-left: 0.5em;
  }
</style>
