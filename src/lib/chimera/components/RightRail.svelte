<script lang="ts">
	// chimera-desktop right rail: vertical strip of icon buttons + a slide-out
	// panel for each chimera-specific surface. v0 stubs only — each tab shows
	// "not yet implemented" copy plus the flag that needs to be passed to
	// `chimera serve` to enable the backing route. Live wiring lands in
	// future slices.
	import { Database, AudioLines, Image, ArrowUpDown, Layers } from '@lucide/svelte';
	import { shellState, type ChimeraPanel } from '$lib/chimera/state.svelte';

	type TabDef = {
		id: ChimeraPanel;
		label: string;
		icon: typeof Database;
		flag: string;
		summary: string;
	};

	const tabs: TabDef[] = [
		{
			id: 'rag',
			label: 'RAG',
			icon: Database,
			flag: '--enable-rag <embed.gguf>',
			summary: 'Vector store CRUD, ingest from text or file, KNN search.'
		},
		{
			id: 'audio',
			label: 'Audio',
			icon: AudioLines,
			flag: '--enable-audio <whisper.gguf>',
			summary: 'WAV transcription + translate-to-English via whisper.cpp.'
		},
		{
			id: 'image',
			label: 'Image',
			icon: Image,
			flag: '--enable-image <sd.gguf>',
			summary: 'txt2img, img2img, inpaint, LoRA picker via stable-diffusion.cpp.'
		},
		{
			id: 'rerank',
			label: 'Rerank',
			icon: ArrowUpDown,
			flag: '--reranking <rerank.gguf>',
			summary: 'Cross-encoder rerank for retrieval-augmented pipelines.'
		},
		{
			id: 'lora',
			label: 'LoRA',
			icon: Layers,
			flag: '--lora <adapter.gguf> [...]',
			summary: 'List registered LoRA adapters and hot-swap scales without a model reload.'
		}
	];

	let activePanel = $derived(shellState.activePanel);
	let activeTab = $derived(tabs.find((t) => t.id === activePanel) ?? null);
</script>

<aside class="chimera-rail">
	<nav class="chimera-rail__strip">
		{#each tabs as tab (tab.id)}
			<button
				type="button"
				class="chimera-rail__tab"
				class:chimera-rail__tab--active={activePanel === tab.id}
				title="{tab.label} — {tab.flag}"
				aria-pressed={activePanel === tab.id}
				onclick={() => shellState.setActivePanel(tab.id)}
			>
				<tab.icon size={18} />
				<span class="chimera-rail__tab-label">{tab.label}</span>
			</button>
		{/each}
	</nav>

	{#if activeTab}
		<section class="chimera-rail__panel">
			<header class="chimera-rail__panel-header">
				<h2>{activeTab.label}</h2>
				<button
					type="button"
					class="chimera-rail__close"
					aria-label="close panel"
					onclick={() => shellState.setActivePanel('none')}>×</button
				>
			</header>
			<div class="chimera-rail__panel-body">
				<p class="chimera-rail__panel-summary">{activeTab.summary}</p>
				<p class="chimera-rail__panel-hint">
					Not yet implemented in this slice. The backing chimera route is wired
					(<code>{activeTab.flag}</code> on <code>chimera serve</code>); the UI
					panel is a future slice.
				</p>
			</div>
		</section>
	{/if}
</aside>

<style>
	.chimera-rail {
		display: flex;
		flex-direction: row;
		height: 100%;
		border-left: 1px solid var(--border, #333);
		background: var(--background, #1a1a1a);
	}

	.chimera-rail__strip {
		display: flex;
		flex-direction: column;
		width: 56px;
		padding: 0.5rem 0;
		gap: 0.25rem;
		border-left: 1px solid var(--border, #333);
		background: var(--card, #1f1f1f);
	}

	.chimera-rail__tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		padding: 0.5rem 0.25rem;
		margin: 0 0.25rem;
		border: none;
		background: transparent;
		color: var(--muted-foreground, #888);
		font-size: 0.65rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		cursor: pointer;
		border-radius: 6px;
		transition: background 120ms ease, color 120ms ease;
	}

	.chimera-rail__tab:hover {
		background: var(--accent, #2a2a2a);
		color: var(--foreground, #ddd);
	}

	.chimera-rail__tab--active {
		background: var(--accent, #2a2a2a);
		color: var(--foreground, #eee);
	}

	.chimera-rail__tab-label {
		font-size: 0.6rem;
	}

	.chimera-rail__panel {
		display: flex;
		flex-direction: column;
		width: 320px;
		max-width: 40vw;
		border-left: 1px solid var(--border, #333);
		background: var(--background, #1a1a1a);
		overflow: hidden;
	}

	.chimera-rail__panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border, #333);
	}

	.chimera-rail__panel-header h2 {
		margin: 0;
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted-foreground, #aaa);
	}

	.chimera-rail__close {
		background: transparent;
		border: none;
		color: var(--muted-foreground, #888);
		font-size: 1.5rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.25rem;
	}

	.chimera-rail__close:hover {
		color: var(--foreground, #ddd);
	}

	.chimera-rail__panel-body {
		flex: 1;
		padding: 1rem;
		overflow-y: auto;
		font-size: 0.85rem;
		color: var(--foreground, #ccc);
	}

	.chimera-rail__panel-summary {
		margin: 0 0 1rem 0;
		line-height: 1.5;
	}

	.chimera-rail__panel-hint {
		margin: 0;
		padding: 0.75rem;
		background: var(--muted, #222);
		border-left: 3px solid var(--primary, #5a4d1f);
		border-radius: 4px;
		color: var(--muted-foreground, #aaa);
		font-size: 0.8rem;
		line-height: 1.5;
	}

	.chimera-rail__panel-hint code {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.85em;
		background: var(--background, #1a1a1a);
		padding: 0.05em 0.3em;
		border-radius: 3px;
	}
</style>
