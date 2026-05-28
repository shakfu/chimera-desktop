<script lang="ts">
	// RAG (vector store) panel body for the right rail. Manage collections,
	// ingest text/files, and run hybrid/semantic/lexical search against the
	// chimera sidecar's /v1/vector_stores/* routes.
	import { Loader2, Plus, Trash2, Search, FileUp } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import {
		listStores,
		createStore,
		deleteStore,
		ingestText,
		ingestFile,
		search,
		type VectorStore,
		type SearchHit,
		type SearchMode
	} from '$lib/chimera/rag';

	// null = still probing (owned by RightRail's one-shot feature fetch).
	let { enabled = null }: { enabled?: boolean | null } = $props();

	const MODES: SearchMode[] = ['hybrid', 'semantic', 'lexical'];

	let stores = $state<VectorStore[]>([]);
	let selected = $state<string>('');
	let loadingStores = $state(false);
	let storesError = $state<string | null>(null);
	let loadedOnce = false;

	let newName = $state('');
	let creating = $state(false);
	let confirmingDelete = $state(false);
	let deleting = $state(false);

	let docText = $state('');
	let docSource = $state('');
	let files = $state<FileList | undefined>(undefined);
	let ingesting = $state(false);
	let ingestMsg = $state<string | null>(null);
	let ingestError = $state<string | null>(null);

	let query = $state('');
	let k = $state(5);
	let mode = $state<SearchMode>('hybrid');
	let searching = $state(false);
	let hits = $state<SearchHit[]>([]);
	let searchError = $state<string | null>(null);

	let current = $derived(stores.find((s) => s.id === selected) ?? null);

	$effect(() => {
		if (enabled === true && !loadedOnce) {
			loadedOnce = true;
			refreshStores();
		}
	});

	async function refreshStores(selectName?: string) {
		loadingStores = true;
		storesError = null;
		try {
			stores = await listStores();
			if (selectName && stores.some((s) => s.id === selectName)) {
				selected = selectName;
			} else if (!stores.some((s) => s.id === selected)) {
				selected = stores[0]?.id ?? '';
			}
		} catch (e) {
			storesError = e instanceof Error ? e.message : String(e);
		} finally {
			loadingStores = false;
		}
	}

	async function create() {
		const name = newName.trim();
		if (!name || creating) return;
		creating = true;
		storesError = null;
		try {
			await createStore(name);
			newName = '';
			await refreshStores(name);
		} catch (e) {
			storesError = e instanceof Error ? e.message : String(e);
		} finally {
			creating = false;
		}
	}

	async function removeStore() {
		if (!selected || deleting) return;
		deleting = true;
		storesError = null;
		try {
			await deleteStore(selected);
			hits = [];
			confirmingDelete = false;
			await refreshStores();
		} catch (e) {
			storesError = e instanceof Error ? e.message : String(e);
		} finally {
			deleting = false;
		}
	}

	async function addContent() {
		if (!selected || ingesting) return;
		const text = docText.trim();
		const file = files?.[0] ?? null;
		if (!text && !file) return;
		ingesting = true;
		ingestError = null;
		ingestMsg = null;
		try {
			const r = file
				? await ingestFile(selected, file)
				: await ingestText(selected, text, docSource.trim() || undefined);
			ingestMsg = `Added ${r.chunks_inserted} chunk${r.chunks_inserted === 1 ? '' : 's'}${
				r.source_uri ? ` from ${r.source_uri}` : ''
			}.`;
			docText = '';
			docSource = '';
			files = undefined;
			await refreshStores(selected);
		} catch (e) {
			ingestError = e instanceof Error ? e.message : String(e);
		} finally {
			ingesting = false;
		}
	}

	async function runSearch() {
		if (!selected || searching) return;
		const q = query.trim();
		if (!q) return;
		searching = true;
		searchError = null;
		hits = [];
		try {
			hits = await search(selected, q, k, mode);
			if (hits.length === 0) searchError = 'No matches.';
		} catch (e) {
			searchError = e instanceof Error ? e.message : String(e);
		} finally {
			searching = false;
		}
	}

	const selectClass =
		'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';
</script>

<p class="text-sm text-muted-foreground">
	Build a vector store, ingest text or files, and run semantic search.
</p>

{#if enabled === null}
	<div class="flex items-center gap-2 text-sm text-muted-foreground">
		<Loader2 class="size-4 animate-spin" />
		Checking availability…
	</div>
{:else if enabled === false}
	<div class="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
		<p class="mb-1 font-medium text-foreground">RAG route not enabled</p>
		<p class="leading-relaxed">
			Start the sidecar with an embedding model to enable vector stores. Set
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs">CHIMERA_DESKTOP_RAG_MODEL</code>
			to an embedding <code class="rounded bg-background px-1 py-0.5 font-mono text-xs">.gguf</code>,
			or run <code class="rounded bg-background px-1 py-0.5 font-mono text-xs">make dev</code> with a
			model present at
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs"
				>models/bge-small-en-v1.5-q8_0.gguf</code
			>.
		</p>
	</div>
{:else}
	<div class="flex flex-col gap-5">
		<!-- Collection management -->
		<section class="flex flex-col gap-2">
			<Label for="rag-store">Collection</Label>
			<div class="flex gap-1">
				<select id="rag-store" bind:value={selected} class="{selectClass} min-w-0 flex-1" disabled={stores.length === 0}>
					{#if stores.length === 0}
						<option value="">No collections yet</option>
					{:else}
						{#each stores as s (s.id)}
							<option value={s.id}>{s.name} ({s.file_counts.total})</option>
						{/each}
					{/if}
				</select>
				{#if selected}
					{#if confirmingDelete}
						<Button variant="destructive" size="sm" disabled={deleting} onclick={removeStore}>
							{#if deleting}<Loader2 class="size-4 animate-spin" />{/if}Confirm
						</Button>
						<Button variant="outline" size="sm" onclick={() => (confirmingDelete = false)}>Cancel</Button>
					{:else}
						<Button variant="outline" size="icon" aria-label="Delete collection" onclick={() => (confirmingDelete = true)}>
							<Trash2 class="size-4" />
						</Button>
					{/if}
				{/if}
			</div>
			<div class="flex gap-1">
				<Input placeholder="new collection name" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && create()} />
				<Button variant="outline" size="sm" disabled={!newName.trim() || creating} onclick={create}>
					{#if creating}<Loader2 class="size-4 animate-spin" />{:else}<Plus class="size-4" />{/if}Create
				</Button>
			</div>
			{#if loadingStores}
				<p class="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 class="size-3.5 animate-spin" /> Loading…</p>
			{:else if current}
				<p class="text-xs text-muted-foreground">
					{current.meta.embedding_model.split('/').pop()} · dim {current.meta.dim} · {current.file_counts.total} chunk{current.file_counts.total === 1 ? '' : 's'}
				</p>
			{/if}
			{#if storesError}
				<p class="text-xs text-destructive">{storesError}</p>
			{/if}
		</section>

		{#if selected}
			<!-- Ingest -->
			<section class="flex flex-col gap-2 border-t border-border pt-4">
				<Label for="rag-text">Add content</Label>
				<Textarea id="rag-text" bind:value={docText} placeholder="Paste text to chunk + embed…" rows={4} disabled={!!files?.length} />
				<div class="flex gap-1">
					<Input placeholder="source label (optional)" bind:value={docSource} disabled={!!files?.length} />
				</div>
				<div class="flex items-center gap-2">
					<Input type="file" accept=".txt,.md,.markdown,.json,.csv,text/*" bind:files class="text-xs" />
				</div>
				<Button size="sm" disabled={(!docText.trim() && !files?.length) || ingesting} onclick={addContent}>
					{#if ingesting}<Loader2 class="size-4 animate-spin" /> Ingesting…{:else}<FileUp class="size-4" /> Ingest{/if}
				</Button>
				{#if ingestMsg}<p class="text-xs text-muted-foreground">{ingestMsg}</p>{/if}
				{#if ingestError}<p class="text-xs text-destructive">{ingestError}</p>{/if}
			</section>

			<!-- Search -->
			<section class="flex flex-col gap-2 border-t border-border pt-4">
				<Label for="rag-query">Search</Label>
				<Textarea id="rag-query" bind:value={query} placeholder="Ask a question…" rows={2} />
				<div class="grid grid-cols-2 gap-2">
					<div class="flex flex-col gap-1">
						<Label for="rag-mode" class="text-xs text-muted-foreground">Mode</Label>
						<select id="rag-mode" bind:value={mode} class={selectClass}>
							{#each MODES as m (m)}<option value={m}>{m}</option>{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1">
						<Label for="rag-k" class="text-xs text-muted-foreground">Top k</Label>
						<Input id="rag-k" type="number" min={1} max={50} bind:value={k} />
					</div>
				</div>
				<Button size="sm" disabled={!query.trim() || searching} onclick={runSearch}>
					{#if searching}<Loader2 class="size-4 animate-spin" /> Searching…{:else}<Search class="size-4" /> Search{/if}
				</Button>
				{#if searchError}<p class="text-xs text-muted-foreground">{searchError}</p>{/if}
				{#if hits.length}
					<div class="flex flex-col gap-2">
						{#each hits as h (h.document_id + '-' + h.chunk_index)}
							<div class="rounded-md border border-border bg-card p-2.5 text-sm">
								<div class="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
									<span class="truncate font-mono">{h.source_uri || `doc ${h.document_id}`}</span>
									<span class="shrink-0">{(h.rrf_score ?? 1 - h.distance).toFixed(3)}</span>
								</div>
								<p class="leading-relaxed whitespace-pre-wrap text-card-foreground">{h.text}</p>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</div>
{/if}
