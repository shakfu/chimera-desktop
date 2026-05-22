<script lang="ts">
	// chimera-desktop persisted-chat browser. Reads:
	//   GET /v1/chats?limit=50           — the list view
	//   GET /v1/chats/search?q=…&limit=20 — debounced search
	// Detail view lives at [id]/+page.svelte.
	//
	// Fetches are unqualified relative paths — chimeraFetch in
	// $lib/chimera/sidecar rewrites them to the sidecar's
	// http://127.0.0.1:<port> and routes through tauri-plugin-http.

	import { onMount } from 'svelte';
	import { chdbg } from '$lib/chimera/debug';

	type Chat = {
		id: number;
		object: 'chimera.chat';
		created_at: string;
		updated_at: string;
		title: string;
		model_alias: string;
		message_count: number;
	};

	type ChatListResponse = { object: 'list'; data: Chat[] };

	type SearchHit = {
		chat_id: number;
		message_id: number;
		seq: number;
		role: string;
		snippet: string;
	};

	type SearchResponse = { query: string; hits: SearchHit[] };

	let chats = $state<Chat[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let query = $state('');
	let hits = $state<SearchHit[]>([]);
	let searching = $state(false);
	let searchError = $state<string | null>(null);

	let searchDebounce: ReturnType<typeof setTimeout> | null = null;
	const SEARCH_DELAY_MS = 300;

	let persistenceDisabled = $state(false);

	async function loadList() {
		loading = true;
		error = null;
		persistenceDisabled = false;
		try {
			const r = await fetch('/v1/chats?limit=50');
			if (r.status === 404) {
				// chimera serve only binds /v1/chats* when started with
				// `--persist-chats`. make run does this for you; if you
				// see this branch, the chimera spawn args are missing
				// the flag (see src-tauri/src/sidecar.rs).
				persistenceDisabled = true;
				return;
			}
			if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
			const body = (await r.json()) as ChatListResponse;
			chats = body.data ?? [];
			chdbg(`loaded ${chats.length} persisted chats`);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	async function runSearch(q: string) {
		if (!q.trim()) {
			hits = [];
			searching = false;
			searchError = null;
			return;
		}
		searching = true;
		searchError = null;
		try {
			const r = await fetch(`/v1/chats/search?q=${encodeURIComponent(q)}&limit=20`);
			if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
			const body = (await r.json()) as SearchResponse;
			hits = body.hits ?? [];
		} catch (e) {
			searchError = (e as Error).message;
		} finally {
			searching = false;
		}
	}

	function onQueryInput() {
		if (searchDebounce !== null) clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => runSearch(query), SEARCH_DELAY_MS);
	}

	function formatTime(iso: string): string {
		// chimera stores SQLite TEXT timestamps in `YYYY-MM-DD HH:MM:SS`
		// format (UTC). Parse leniently.
		const isoish = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
		const d = new Date(isoish);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleString();
	}

	// Render the snippet's [word]-highlighted markers as bold spans.
	// Server-side FTS5 wraps matched terms in [brackets]; we convert
	// to inline <mark> for readability. Input is otherwise plain text.
	function renderSnippet(snippet: string): string {
		return snippet
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/\[([^\]]+)\]/g, '<mark>$1</mark>');
	}

	onMount(loadList);
</script>

<svelte:head>
	<title>Persisted chats — chimera-desktop</title>
</svelte:head>

<main class="chats">
	<header class="chats__header">
		<h1>Persisted chats</h1>
		<p class="chats__subtitle">
			From chimera's SQLite store. Click a row to view; type in the search box to find
			messages by content (FTS5).
		</p>
	</header>

	<div class="chats__search">
		<input
			type="search"
			placeholder="Search messages…"
			bind:value={query}
			oninput={onQueryInput}
			class="chats__search-input"
		/>
		{#if searching}<span class="chats__hint">searching…</span>{/if}
		{#if searchError}<span class="chats__error">{searchError}</span>{/if}
	</div>

	{#if query.trim() && hits.length > 0}
		<section class="chats__section">
			<h2>Search results</h2>
			<ul class="chats__hits">
				{#each hits as hit (hit.message_id)}
					<li class="chats__hit">
						<a href="#/chimera/chats/{hit.chat_id}">
							<div class="chats__hit-meta">
								<span class="chats__badge">chat #{hit.chat_id}</span>
								<span class="chats__role">{hit.role}</span>
								<span class="chats__seq">msg seq {hit.seq}</span>
							</div>
							<p class="chats__snippet">{@html renderSnippet(hit.snippet)}</p>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{:else if query.trim() && !searching && hits.length === 0}
		<p class="chats__empty">No matches for "{query}".</p>
	{/if}

	<section class="chats__section">
		<h2>Recent chats</h2>
		{#if loading}
			<p class="chats__empty">Loading…</p>
		{:else if persistenceDisabled}
			<p class="chats__empty">
				chimera's chat-history routes aren't bound. The sidecar needs to be started
				with <code>--persist-chats</code>, which <code>make run</code> normally does for
				you. If you see this message, check <code>src-tauri/src/sidecar.rs</code> — the
				spawn args may have drifted.
			</p>
		{:else if error}
			<p class="chats__error">Failed to load chats: {error}</p>
		{:else if chats.length === 0}
			<p class="chats__empty">
				No persisted chats yet. Send a message in the chat tab and it'll appear here.
			</p>
		{:else}
			<ul class="chats__list">
				{#each chats as chat (chat.id)}
					<li class="chats__row">
						<a href="#/chimera/chats/{chat.id}">
							<div class="chats__row-line">
								<span class="chats__badge">#{chat.id}</span>
								<span class="chats__title">{chat.title || '(untitled)'}</span>
							</div>
							<div class="chats__row-meta">
								<span>{chat.message_count} msg</span>
								<span>·</span>
								<span>{chat.model_alias}</span>
								<span>·</span>
								<span>updated {formatTime(chat.updated_at)}</span>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<style>
	.chats {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		font-family: -apple-system, BlinkMacSystemFont, sans-serif;
		color: var(--foreground, #1a1a1a);
	}

	.chats__header {
		margin-bottom: 1.5rem;
	}

	h1 {
		margin: 0 0 0.25rem 0;
		font-size: 1.5rem;
		font-weight: 600;
	}

	.chats__subtitle {
		margin: 0;
		color: var(--muted-foreground, #777);
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.chats__search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.chats__search-input {
		flex: 1;
		padding: 0.6rem 0.9rem;
		font-size: 0.95rem;
		border: 1px solid var(--border, #ccc);
		border-radius: 8px;
		background: var(--background, transparent);
		color: inherit;
	}

	.chats__hint {
		color: var(--muted-foreground, #888);
		font-size: 0.85rem;
	}

	.chats__section {
		margin-bottom: 2rem;
	}

	.chats__section h2 {
		font-size: 0.85rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted-foreground, #888);
		margin: 0 0 0.75rem 0;
	}

	.chats__list,
	.chats__hits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.chats__row a,
	.chats__hit a {
		display: block;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border, #ddd);
		border-radius: 8px;
		text-decoration: none;
		color: inherit;
		transition: background 100ms ease;
	}

	.chats__row a:hover,
	.chats__hit a:hover {
		background: var(--accent, #f5f5f5);
	}

	.chats__row-line {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.25rem;
	}

	.chats__badge {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.75rem;
		padding: 0.1em 0.5em;
		background: var(--muted, #eee);
		color: var(--muted-foreground, #555);
		border-radius: 4px;
	}

	.chats__title {
		font-size: 0.95rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chats__row-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--muted-foreground, #888);
	}

	.chats__hit-meta {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
		font-size: 0.78rem;
		color: var(--muted-foreground, #888);
	}

	.chats__role {
		text-transform: uppercase;
		font-weight: 600;
	}

	.chats__snippet {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--foreground, #333);
	}

	.chats__snippet :global(mark) {
		background: #ffe680;
		color: #5a4d1f;
		padding: 0 0.15em;
		border-radius: 2px;
	}

	.chats__empty {
		color: var(--muted-foreground, #888);
		font-size: 0.9rem;
		margin: 0;
		padding: 1rem;
		border: 1px dashed var(--border, #ccc);
		border-radius: 8px;
		background: var(--muted, transparent);
	}

	.chats__empty code {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.85em;
		background: var(--background, #f5f5f5);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}

	.chats__error {
		color: #d14a4a;
	}
</style>
