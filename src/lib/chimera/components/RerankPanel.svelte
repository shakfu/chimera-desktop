<script lang="ts">
	// Cross-encoder rerank panel body for the right rail. Enter a query and a
	// set of candidate documents, then score + reorder them against the query
	// via the chimera sidecar's /v1/rerank route.
	import { Loader2, Plus, Trash2, ArrowUpDown } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { rerank, type RankedDocument } from '$lib/chimera/rerank';

	// null = still probing (owned by RightRail's one-shot feature fetch).
	let { enabled = null }: { enabled?: boolean | null } = $props();

	let query = $state('');
	// Candidate documents, one per textarea. Start with three empty slots so
	// the panel reads as "fill these in" rather than an empty void.
	let docs = $state<string[]>(['', '', '']);
	let reranking = $state(false);
	let results = $state<RankedDocument[]>([]);
	let error = $state<string | null>(null);

	// Non-empty documents paired with their original 1-based slot number, so
	// the results can show how far each candidate moved.
	let filled = $derived(
		docs.map((text, i) => ({ text: text.trim(), slot: i + 1 })).filter((d) => d.text)
	);
	let canRerank = $derived(query.trim().length > 0 && filled.length >= 2 && !reranking);

	// Min/max raw score across the result set, for normalizing the score bars.
	// Scores are unbounded logits (often negative), so a bar is only meaningful
	// relative to the other results in the same run.
	let scoreRange = $derived.by(() => {
		if (results.length === 0) return { min: 0, max: 1 };
		const scores = results.map((r) => r.score);
		return { min: Math.min(...scores), max: Math.max(...scores) };
	});

	function barWidth(score: number): number {
		const { min, max } = scoreRange;
		if (max === min) return 100;
		return Math.round(((score - min) / (max - min)) * 100);
	}

	// Map a ranked result's original document index back to its 1-based input
	// slot, so we can show "slot 3 -> rank 1" reordering.
	function slotFor(index: number): number {
		return index + 1;
	}

	function addDoc() {
		docs = [...docs, ''];
	}

	function removeDoc(i: number) {
		docs = docs.filter((_, idx) => idx !== i);
		if (docs.length === 0) docs = [''];
	}

	async function runRerank() {
		if (!canRerank) return;
		reranking = true;
		error = null;
		results = [];
		try {
			results = await rerank(
				query.trim(),
				filled.map((d) => d.text)
			);
			if (results.length === 0) error = 'No results returned.';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			reranking = false;
		}
	}
</script>

<p class="text-sm text-muted-foreground">
	Score a set of candidate documents against a query with a cross-encoder, then reorder by relevance.
</p>

{#if enabled === null}
	<div class="flex items-center gap-2 text-sm text-muted-foreground">
		<Loader2 class="size-4 animate-spin" />
		Checking availability…
	</div>
{:else if enabled === false}
	<div class="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
		<p class="mb-1 font-medium text-foreground">Rerank route not enabled</p>
		<p class="leading-relaxed">
			Start the sidecar with a cross-encoder reranker to enable this panel. Set
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs">CHIMERA_DESKTOP_RERANK_MODEL</code>
			to a reranker <code class="rounded bg-background px-1 py-0.5 font-mono text-xs">.gguf</code>,
			or run <code class="rounded bg-background px-1 py-0.5 font-mono text-xs">make dev</code> with a
			model present at
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs"
				>models/bge-reranker-base-q8_0.gguf</code
			>.
		</p>
	</div>
{:else}
	<div class="flex flex-col gap-5">
		<!-- Query -->
		<section class="flex flex-col gap-2">
			<Label for="rerank-query">Query</Label>
			<Textarea id="rerank-query" bind:value={query} placeholder="What are you ranking against?" rows={2} />
		</section>

		<!-- Candidate documents -->
		<section class="flex flex-col gap-2 border-t border-border pt-4">
			<div class="flex items-center justify-between">
				<Label>Documents</Label>
				<Button variant="outline" size="sm" onclick={addDoc}>
					<Plus class="size-4" /> Add
				</Button>
			</div>
			{#each docs as _doc, i (i)}
				<div class="flex items-start gap-1">
					<Textarea bind:value={docs[i]} placeholder={`Document ${i + 1}`} rows={2} class="min-w-0 flex-1" />
					<Button
						variant="outline"
						size="icon"
						aria-label={`Remove document ${i + 1}`}
						onclick={() => removeDoc(i)}
					>
						<Trash2 class="size-4" />
					</Button>
				</div>
			{/each}
			<Button size="sm" disabled={!canRerank} onclick={runRerank}>
				{#if reranking}<Loader2 class="size-4 animate-spin" /> Reranking…{:else}<ArrowUpDown class="size-4" /> Rerank{/if}
			</Button>
			{#if filled.length < 2 && !error}
				<p class="text-xs text-muted-foreground">Add at least two documents to rerank.</p>
			{/if}
			{#if error}<p class="text-xs text-destructive">{error}</p>{/if}
		</section>

		<!-- Ranked results -->
		{#if results.length}
			<section class="flex flex-col gap-2 border-t border-border pt-4">
				<Label>Ranked results</Label>
				{#each results as r (r.index)}
					{@const moved = slotFor(r.index) - r.rank}
					<div class="rounded-md border border-border bg-card p-2.5 text-sm">
						<div class="mb-1.5 flex items-center justify-between gap-2 text-xs">
							<span class="flex items-center gap-1.5">
								<span class="rounded bg-primary/15 px-1.5 py-0.5 font-mono font-semibold text-foreground">#{r.rank}</span>
								<span class="text-muted-foreground">
									was doc {slotFor(r.index)}{#if moved > 0}
										<span class="text-green-600">(+{moved})</span>
									{:else if moved < 0}
										<span class="text-muted-foreground">(-{-moved})</span>
									{/if}
								</span>
							</span>
							<span class="shrink-0 font-mono text-muted-foreground">{r.score.toFixed(3)}</span>
						</div>
						<div class="mb-1.5 h-1 overflow-hidden rounded-full bg-muted">
							<div class="h-full rounded-full bg-primary" style="width: {barWidth(r.score)}%"></div>
						</div>
						<p class="leading-relaxed whitespace-pre-wrap text-card-foreground">{r.document}</p>
					</div>
				{/each}
			</section>
		{/if}
	</div>
{/if}
