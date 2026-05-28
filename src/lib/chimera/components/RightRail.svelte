<script lang="ts">
	// chimera-desktop right rail: a vertical strip of icon buttons plus a
	// slide-out panel for each chimera modality. Audio is wired end-to-end;
	// the others are stubs that document the `chimera serve` flag enabling
	// their backing route, pending future slices.
	import { Database, AudioLines, Image, ArrowUpDown, Layers, X } from '@lucide/svelte';
	import { shellState, type ChimeraPanel } from '$lib/chimera/state.svelte';
	import { Button } from '$lib/components/ui/button';
	import AudioPanel from './AudioPanel.svelte';

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
			summary: 'Audio transcription + translate-to-English via whisper.cpp.'
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

<aside class="flex h-full flex-row border-l border-border bg-background">
	<nav class="flex w-14 flex-col gap-1 border-l border-border bg-card px-1.5 py-2">
		{#each tabs as tab (tab.id)}
			{@const active = activePanel === tab.id}
			<button
				type="button"
				class="flex flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-[0.6rem] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:bg-accent hover:text-foreground {active
					? 'bg-accent text-foreground'
					: ''}"
				title="{tab.label} — {tab.flag}"
				aria-pressed={active}
				onclick={() => shellState.setActivePanel(tab.id)}
			>
				<tab.icon size={18} />
				<span>{tab.label}</span>
			</button>
		{/each}
	</nav>

	{#if activeTab}
		<section class="flex w-80 max-w-[40vw] flex-col overflow-hidden border-l border-border">
			<header class="flex items-center justify-between border-b border-border px-4 py-3">
				<h2 class="text-sm font-semibold text-foreground">{activeTab.label}</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close panel"
					onclick={() => shellState.setActivePanel('none')}
				>
					<X class="size-4" />
				</Button>
			</header>

			<div class="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
				{#if activeTab.id === 'audio'}
					<AudioPanel />
				{:else}
					<p class="text-sm text-muted-foreground">{activeTab.summary}</p>
					<div
						class="rounded-md border-l-2 border-primary/40 bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground"
					>
						Not yet implemented in this slice. The backing chimera route is wired
						(<code class="rounded bg-background px-1 py-0.5 font-mono text-xs text-foreground"
							>{activeTab.flag}</code
						>
						on <code class="rounded bg-background px-1 py-0.5 font-mono text-xs text-foreground"
							>chimera serve</code
						>); the UI panel is a future slice.
					</div>
				{/if}
			</div>
		</section>
	{/if}
</aside>
