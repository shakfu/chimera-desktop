<script lang="ts">
	// Runtime diagnostics for the chimera sidecar. Polls the Rust-side
	// `sidecar_port` and `sidecar_status` Tauri commands, then probes
	// chimera's /health endpoint directly and fetches /v1/models +
	// /props for display. Useful when the chat UI shows
	// "Server unavailable" — this page tells you exactly which layer
	// is broken.

	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';

	type SidecarStatus =
		| { kind: 'NotStarted' }
		| { kind: 'Starting' }
		| { kind: 'Running' }
		| { kind: 'Failed'; detail: string }
		| { kind: 'Exited'; detail: number };

	let port = $state<number | null>(null);
	let status = $state<SidecarStatus>({ kind: 'NotStarted' });
	let healthOk = $state(false);
	let modelInfo = $state<unknown>(null);
	let props = $state<unknown>(null);
	let error = $state<string | null>(null);

	async function refreshStatus() {
		try {
			const [p, s] = await Promise.all([
				invoke<number | null>('sidecar_port'),
				invoke<SidecarStatus>('sidecar_status')
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
				fetch(`http://127.0.0.1:${p}/props`).then((r) => r.json())
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
				if (status.kind === 'Failed' || status.kind === 'Exited') return;
				if (port !== null && (await probeHealth(port))) {
					healthOk = true;
					await invoke('sidecar_mark_ready');
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

<svelte:head>
	<title>Diagnostics — chimera-desktop</title>
</svelte:head>

<main class="diag">
	<header class="diag__header">
		<h1>Diagnostics</h1>
		<p class="diag__subtitle">
			Sidecar lifecycle, HTTP reachability, and a snapshot of chimera's
			<code>/v1/models</code> and <code>/props</code> responses. Useful when the chat shows
			"Server unavailable" — this page tells you which layer is broken.
		</p>
	</header>

	<section class="diag__card">
		<h2>Sidecar</h2>
		<dl>
			<dt>status</dt>
			<dd>
				<span class="diag__badge diag__badge--{status.kind.toLowerCase()}">{status.kind}</span>
				{#if status.kind === 'Failed'}<span class="diag__error">— {status.detail}</span>{/if}
				{#if status.kind === 'Exited'}<span class="diag__error">— exit code {status.detail}</span
					>{/if}
			</dd>
			<dt>port</dt>
			<dd>{port ?? '(not assigned yet)'}</dd>
			<dt>health</dt>
			<dd>{healthOk ? '200 OK' : '(awaiting)'}</dd>
		</dl>
	</section>

	{#if modelInfo}
		<section class="diag__card">
			<h2>/v1/models</h2>
			<pre>{JSON.stringify(modelInfo, null, 2)}</pre>
		</section>
	{/if}

	{#if props}
		<section class="diag__card">
			<h2>/props (excerpt)</h2>
			<dl>
				<dt>model alias</dt>
				<dd>{(props as any)?.model_alias ?? '—'}</dd>
				<dt>default temperature</dt>
				<dd>{(props as any)?.default_generation_settings?.temperature ?? '—'}</dd>
				<dt>default top_k</dt>
				<dd>{(props as any)?.default_generation_settings?.top_k ?? '—'}</dd>
				<dt>n_ctx</dt>
				<dd>{(props as any)?.default_generation_settings?.n_ctx ?? '—'}</dd>
			</dl>
		</section>
	{/if}

	{#if status.kind === 'Failed'}
		<section class="diag__card diag__card--hint">
			<h2>Setup hint</h2>
			<p>
				The Rust side could not spawn the chimera sidecar. Most common cause: the
				<code>CHIMERA_DESKTOP_MODEL</code> environment variable is unset. Use
				<code>make run</code> (which exports it from the <code>MODEL</code> make variable), or set it
				yourself:
			</p>
			<pre>export CHIMERA_DESKTOP_MODEL=/absolute/path/to/model.gguf
npm run tauri dev</pre>
		</section>
	{/if}

	{#if error}
		<section class="diag__card diag__card--error">
			<h2>Error</h2>
			<pre>{error}</pre>
		</section>
	{/if}
</main>

<style>
	.diag {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
		font-family: -apple-system, BlinkMacSystemFont, sans-serif;
		color: var(--foreground, #1a1a1a);
	}

	.diag__header {
		margin-bottom: 1.5rem;
	}

	h1 {
		margin: 0 0 0.25rem 0;
		font-size: 1.5rem;
		font-weight: 600;
	}

	.diag__subtitle {
		margin: 0;
		color: var(--muted-foreground, #777);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.diag__subtitle code {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.85em;
		background: var(--muted, #f0f0f0);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}

	.diag__card {
		background: var(--card, transparent);
		border: 1px solid var(--border, #ddd);
		border-radius: 8px;
		padding: 1.25rem 1.5rem;
		margin-bottom: 1rem;
	}

	.diag__card--hint {
		border-color: var(--primary, #d1b04a);
	}

	.diag__card--error {
		border-color: #d14a4a;
	}

	.diag__card h2 {
		margin: 0 0 0.75rem 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--muted-foreground, #777);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	dl {
		margin: 0;
		display: grid;
		grid-template-columns: 180px 1fr;
		gap: 0.5rem 1rem;
	}

	dt {
		color: var(--muted-foreground, #777);
		font-size: 0.9rem;
	}

	dd {
		margin: 0;
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.9rem;
	}

	.diag__badge {
		display: inline-block;
		padding: 0.15em 0.6em;
		border-radius: 4px;
		font-size: 0.85em;
		font-weight: 500;
	}
	.diag__badge--notstarted {
		background: #e0e0e0;
		color: #555;
	}
	.diag__badge--starting {
		background: #fff3c4;
		color: #5a4d1f;
	}
	.diag__badge--running {
		background: #c4f3d4;
		color: #1f5a3a;
	}
	.diag__badge--failed,
	.diag__badge--exited {
		background: #ffd0d0;
		color: #5a1f1f;
	}

	pre {
		background: var(--muted, #f5f5f5);
		border: 1px solid var(--border, #ddd);
		border-radius: 4px;
		padding: 0.75rem;
		overflow-x: auto;
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.8rem;
		color: var(--foreground, #1a1a1a);
	}

	code {
		background: var(--muted, #f0f0f0);
		padding: 0.1em 0.3em;
		border-radius: 3px;
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.9em;
	}

	.diag__error {
		color: #d14a4a;
		margin-left: 0.5em;
	}
</style>
