<script lang="ts">
	// Read-only chat detail view. Reads GET /v1/chats/:id, which returns
	// the chat metadata plus an ordered messages[] array. Markdown is
	// not rendered (yet) — content shows as plain text with newlines
	// preserved. A future slice will hook up upstream's renderer.

	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { chdbg } from '$lib/chimera/debug';

	type StoredMessage = {
		id: number;
		chat_id: number;
		seq: number;
		role: 'system' | 'user' | 'assistant' | string;
		content: string;
		reasoning: string | null;
		tokens_in: number | null;
		tokens_out: number | null;
		created_at: string;
		partial: boolean;
	};

	type ChatDetail = {
		id: number;
		object: 'chimera.chat';
		created_at: string;
		updated_at: string;
		title: string;
		model_alias: string;
		system_prompt: string | null;
		message_count: number;
		messages: StoredMessage[];
	};

	let chat = $state<ChatDetail | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	const chatId = $derived(page.params.id);

	async function load(id: string) {
		loading = true;
		error = null;
		try {
			const r = await fetch(`/v1/chats/${id}`);
			if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
			chat = (await r.json()) as ChatDetail;
			chdbg(`loaded chat ${id}: ${chat.messages.length} messages`);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (chatId) load(chatId);
	});

	$effect(() => {
		if (chatId) load(chatId);
	});

	function formatTime(iso: string): string {
		const isoish = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
		const d = new Date(isoish);
		if (Number.isNaN(d.getTime())) return iso;
		return d.toLocaleString();
	}
</script>

<svelte:head>
	<title>Chat #{chatId} — chimera-desktop</title>
</svelte:head>

<main class="chat-detail">
	<header class="chat-detail__header">
		<a class="chat-detail__back" href="#/chimera/chats">← all chats</a>
		{#if chat}
			<h1>{chat.title || '(untitled)'}</h1>
			<div class="chat-detail__meta">
				<span class="chats__badge">#{chat.id}</span>
				<span>{chat.message_count} messages</span>
				<span>·</span>
				<span>{chat.model_alias}</span>
				<span>·</span>
				<span>created {formatTime(chat.created_at)}</span>
			</div>
			{#if chat.system_prompt}
				<details class="chat-detail__system">
					<summary>system prompt</summary>
					<pre>{chat.system_prompt}</pre>
				</details>
			{/if}
		{/if}
	</header>

	{#if loading && !chat}
		<p class="chat-detail__empty">Loading…</p>
	{:else if error}
		<p class="chat-detail__error">Failed to load: {error}</p>
	{:else if chat}
		<ol class="chat-detail__messages">
			{#each chat.messages as m (m.id)}
				<li class="msg msg--{m.role}">
					<div class="msg__head">
						<span class="msg__role">{m.role}</span>
						{#if m.partial}<span class="msg__partial">partial</span>{/if}
						<span class="msg__seq">seq {m.seq}</span>
						{#if m.tokens_in != null || m.tokens_out != null}
							<span class="msg__tokens">
								{m.tokens_in ?? 0} in / {m.tokens_out ?? 0} out
							</span>
						{/if}
					</div>
					<pre class="msg__content">{m.content}</pre>
					{#if m.reasoning}
						<details class="msg__reasoning">
							<summary>reasoning</summary>
							<pre>{m.reasoning}</pre>
						</details>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</main>

<style>
	.chat-detail {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		font-family: -apple-system, BlinkMacSystemFont, sans-serif;
		color: var(--foreground, #1a1a1a);
	}

	.chat-detail__back {
		display: inline-block;
		font-size: 0.85rem;
		color: var(--muted-foreground, #777);
		text-decoration: none;
		margin-bottom: 1rem;
	}

	.chat-detail__back:hover {
		color: var(--foreground, #1a1a1a);
		text-decoration: underline;
	}

	h1 {
		margin: 0 0 0.5rem 0;
		font-size: 1.4rem;
		font-weight: 600;
	}

	.chat-detail__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--muted-foreground, #777);
		margin-bottom: 1rem;
	}

	.chats__badge {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.75rem;
		padding: 0.1em 0.5em;
		background: var(--muted, #eee);
		color: var(--muted-foreground, #555);
		border-radius: 4px;
	}

	.chat-detail__system {
		margin: 0 0 1.5rem 0;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border, #ddd);
		border-radius: 6px;
		background: var(--muted, #f5f5f5);
		font-size: 0.85rem;
	}

	.chat-detail__system summary {
		cursor: pointer;
		font-weight: 500;
		color: var(--muted-foreground, #555);
	}

	.chat-detail__system pre {
		margin: 0.5rem 0 0 0;
		white-space: pre-wrap;
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.8rem;
	}

	.chat-detail__empty,
	.chat-detail__error {
		color: var(--muted-foreground, #888);
		font-size: 0.9rem;
		padding: 1rem;
		border: 1px dashed var(--border, #ccc);
		border-radius: 8px;
	}

	.chat-detail__error {
		color: #d14a4a;
	}

	.chat-detail__messages {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.msg {
		padding: 0.75rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--border, #ddd);
	}

	.msg--user {
		background: var(--muted, #f5f5f5);
	}

	.msg--assistant {
		background: var(--background, transparent);
	}

	.msg--system {
		background: var(--card, #fff8e8);
		border-style: dashed;
	}

	.msg__head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.5rem;
		font-size: 0.75rem;
	}

	.msg__role {
		text-transform: uppercase;
		font-weight: 700;
		color: var(--muted-foreground, #555);
		letter-spacing: 0.04em;
	}

	.msg__partial {
		padding: 0 0.4em;
		background: #ffe680;
		color: #5a4d1f;
		border-radius: 3px;
		font-weight: 600;
	}

	.msg__seq,
	.msg__tokens {
		color: var(--muted-foreground, #888);
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.7rem;
	}

	.msg__content {
		margin: 0;
		white-space: pre-wrap;
		word-wrap: break-word;
		font-family: -apple-system, BlinkMacSystemFont, sans-serif;
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--foreground, #1a1a1a);
	}

	.msg__reasoning {
		margin-top: 0.5rem;
		padding: 0.4rem 0.6rem;
		background: var(--muted, #f5f5f5);
		border-radius: 4px;
		font-size: 0.8rem;
	}

	.msg__reasoning pre {
		margin: 0.3rem 0 0 0;
		white-space: pre-wrap;
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.75rem;
		color: var(--muted-foreground, #555);
	}
</style>
