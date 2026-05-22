<script lang="ts">
	// About pane — backed by chimera's GET /v1/chimera/info, which
	// returns the JSON form of `chimera info`. See chimera's
	// chimera_serve_meta.cpp for the response shape.

	import { onMount } from 'svelte';

	type Device = { name: string; type: string; description: string };

	type ChimeraInfo = {
		object: 'chimera.info';
		chimera: { version: string; platform: string };
		llama_cpp: {
			version: string;
			ggml_version: string;
			ggml_commit: string;
			built_backends: string[];
			loaded_backend: string;
			registries: string[];
			devices: Device[];
			gpu_offload: boolean;
			mmap_support: boolean;
			mlock_support: boolean;
			rpc_support: boolean;
		};
		whisper_cpp:
			| { linked: false }
			| { linked: true; version: string; ggml_version: string; cpu_features: string[] };
		stable_diffusion_cpp:
			| { linked: false }
			| { linked: true; version: string; ggml_version: string; cpu_features: string[] };
		sqlite: { version: string; sqlite_vec: string };
		build_flags: Record<string, string>;
	};

	let info = $state<ChimeraInfo | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	async function load() {
		loading = true;
		error = null;
		try {
			const r = await fetch('/v1/chimera/info');
			if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
			info = (await r.json()) as ChimeraInfo;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>About — chimera-desktop</title>
</svelte:head>

<main class="about">
	<header class="about__header">
		<h1>About</h1>
		<p class="about__subtitle">
			Versions, backends, devices, and build flags reported by the bundled chimera sidecar.
			Equivalent to running <code>chimera info</code> at the CLI; sourced from
			<code>GET /v1/chimera/info</code>.
		</p>
	</header>

	{#if loading}
		<p class="about__empty">Loading…</p>
	{:else if error}
		<p class="about__error">Failed to load: {error}</p>
	{:else if info}
		<section class="about__card">
			<h2>chimera</h2>
			<dl>
				<dt>version</dt>
				<dd>{info.chimera.version}</dd>
				<dt>platform</dt>
				<dd>{info.chimera.platform}</dd>
			</dl>
		</section>

		<section class="about__card">
			<h2>llama.cpp</h2>
			<dl>
				<dt>version</dt>
				<dd>{info.llama_cpp.version}</dd>
				<dt>ggml version</dt>
				<dd>{info.llama_cpp.ggml_version} ({info.llama_cpp.ggml_commit})</dd>
				<dt>built backends</dt>
				<dd>{info.llama_cpp.built_backends.join(', ') || '—'}</dd>
				<dt>loaded backend</dt>
				<dd>{info.llama_cpp.loaded_backend}</dd>
				<dt>registries</dt>
				<dd>{info.llama_cpp.registries.join(', ')}</dd>
				<dt>GPU offload</dt>
				<dd>{info.llama_cpp.gpu_offload ? 'yes' : 'no'}</dd>
				<dt>mmap support</dt>
				<dd>{info.llama_cpp.mmap_support ? 'yes' : 'no'}</dd>
				<dt>mlock support</dt>
				<dd>{info.llama_cpp.mlock_support ? 'yes' : 'no'}</dd>
				<dt>RPC support</dt>
				<dd>{info.llama_cpp.rpc_support ? 'yes' : 'no'}</dd>
			</dl>
		</section>

		<section class="about__card">
			<h2>devices</h2>
			{#if info.llama_cpp.devices.length === 0}
				<p class="about__empty">No devices reported.</p>
			{:else}
				<ul class="about__devices">
					{#each info.llama_cpp.devices as d (d.name)}
						<li>
							<span class="about__badge">{d.type}</span>
							<span class="about__device-name">{d.name}</span>
							{#if d.description}<span class="about__device-desc">{d.description}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="about__card">
			<h2>whisper.cpp</h2>
			{#if info.whisper_cpp.linked}
				<dl>
					<dt>version</dt>
					<dd>{info.whisper_cpp.version}</dd>
					<dt>ggml version</dt>
					<dd>{info.whisper_cpp.ggml_version}</dd>
					<dt>CPU features</dt>
					<dd>{info.whisper_cpp.cpu_features.join(', ') || '—'}</dd>
				</dl>
			{:else}
				<p class="about__empty">Not linked (built with <code>CHIMERA_WITH_WHISPER=OFF</code>).</p>
			{/if}
		</section>

		<section class="about__card">
			<h2>stable-diffusion.cpp</h2>
			{#if info.stable_diffusion_cpp.linked}
				<dl>
					<dt>version</dt>
					<dd>{info.stable_diffusion_cpp.version}</dd>
					<dt>ggml version</dt>
					<dd>{info.stable_diffusion_cpp.ggml_version}</dd>
					<dt>CPU features</dt>
					<dd>{info.stable_diffusion_cpp.cpu_features.join(', ') || '—'}</dd>
				</dl>
			{:else}
				<p class="about__empty">Not linked (built with <code>CHIMERA_WITH_SD=OFF</code>).</p>
			{/if}
		</section>

		<section class="about__card">
			<h2>SQLite + sqlite-vec</h2>
			<dl>
				<dt>sqlite</dt>
				<dd>{info.sqlite.version}</dd>
				<dt>sqlite-vec</dt>
				<dd>{info.sqlite.sqlite_vec}</dd>
			</dl>
		</section>

		{#if Object.keys(info.build_flags).length > 0}
			<section class="about__card">
				<h2>build flags</h2>
				<dl>
					{#each Object.entries(info.build_flags) as [k, v] (k)}
						<dt>{k}</dt>
						<dd>{v}</dd>
					{/each}
				</dl>
			</section>
		{/if}
	{/if}
</main>

<style>
	.about {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem 4rem;
		font-family: -apple-system, BlinkMacSystemFont, sans-serif;
		color: var(--foreground, #1a1a1a);
	}
	.about__header { margin-bottom: 1.5rem; }
	h1 { margin: 0 0 0.25rem 0; font-size: 1.5rem; font-weight: 600; }
	.about__subtitle {
		margin: 0;
		color: var(--muted-foreground, #777);
		font-size: 0.9rem;
		line-height: 1.5;
	}
	.about__subtitle code {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.85em;
		background: var(--muted, #f0f0f0);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}
	.about__card {
		background: var(--card, transparent);
		border: 1px solid var(--border, #ddd);
		border-radius: 8px;
		padding: 1.25rem 1.5rem;
		margin-bottom: 1rem;
	}
	.about__card h2 {
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
		grid-template-columns: 200px 1fr;
		gap: 0.5rem 1rem;
	}
	dt { color: var(--muted-foreground, #777); font-size: 0.9rem; }
	dd {
		margin: 0;
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.9rem;
	}
	.about__devices {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.about__devices li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.9rem;
	}
	.about__badge {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.7rem;
		padding: 0.15em 0.5em;
		background: var(--muted, #eee);
		color: var(--muted-foreground, #555);
		border-radius: 4px;
		min-width: 3em;
		text-align: center;
	}
	.about__device-name {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-weight: 500;
	}
	.about__device-desc { color: var(--muted-foreground, #888); }
	.about__empty {
		color: var(--muted-foreground, #888);
		font-size: 0.9rem;
		margin: 0;
		padding: 1rem;
		border: 1px dashed var(--border, #ccc);
		border-radius: 8px;
	}
	.about__empty code {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.85em;
		background: var(--background, #f5f5f5);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}
	.about__error { color: #d14a4a; }
	code {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.9em;
		background: var(--muted, #f0f0f0);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}
</style>
