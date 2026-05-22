<script lang="ts">
	// chimera-desktop status bar: thin strip at the bottom of the shell.
	// Surfaces the data a chat-only upstream UI does not expose:
	//   - sidecar base URL (port picked by Rust at app start)
	//   - sidecar status (running / failed / exited / unknown)
	//   - loaded model alias (sourced from upstream's serverStore once
	//     /props has resolved)
	// `/v1/chimera/info` and `/v1/chimera/db` are upstream-side TODOs;
	// when they land, this bar grows backend + DB size badges.

	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { Circle, Link2 } from '@lucide/svelte';
	import { shellState } from '$lib/chimera/state.svelte';
	import { serverStore } from '$lib/stores/server.svelte';

	type SidecarStatusKind = 'NotStarted' | 'Starting' | 'Running' | 'Failed' | 'Exited';
	type SidecarStatus = { kind: SidecarStatusKind; detail?: string | number };

	const dotColor: Record<SidecarStatusKind, string> = {
		NotStarted: '#666',
		Starting: '#d1b04a',
		Running: '#4ad181',
		Failed: '#d14a4a',
		Exited: '#d14a4a'
	};

	let baseUrl = $derived(shellState.sidecarBaseUrl);
	let status = $derived(shellState.sidecarStatus);
	let modelAlias = $derived(serverStore.props?.model_alias ?? shellState.loadedModel ?? null);

	const kindToStatus: Record<SidecarStatusKind, 'unknown' | 'starting' | 'running' | 'failed' | 'exited'> = {
		NotStarted: 'unknown',
		Starting: 'starting',
		Running: 'running',
		Failed: 'failed',
		Exited: 'exited'
	};

	// Adaptive poll cadence:
	//   - Starting / unknown: 2s (waiting for the sidecar to come up)
	//   - Running: 10s (sidecar is healthy; no need to hammer it)
	//   - Failed / Exited: stop polling entirely (status won't change
	//     without a restart)
	// Implemented with setTimeout chains rather than a fixed setInterval
	// so the rate updates between every tick. Tracked via a ref so the
	// cleanup function can cancel the pending timer.
	async function poll() {
		try {
			const s = await invoke<SidecarStatus>('sidecar_status');
			shellState.setSidecarStatus(kindToStatus[s.kind]);
			shellState.refresh();
		} catch {
			/* ignore — tauri host may not be ready yet */
		}
	}

	function nextInterval(s: typeof status): number | null {
		if (s === 'failed' || s === 'exited') return null;
		if (s === 'running') return 10000;
		return 2000;
	}

	onMount(() => {
		let cancelled = false;
		let timeout: ReturnType<typeof setTimeout> | null = null;

		async function tick() {
			if (cancelled) return;
			await poll();
			const delay = nextInterval(status);
			if (delay !== null && !cancelled) {
				timeout = setTimeout(tick, delay);
			}
		}

		tick();

		return () => {
			cancelled = true;
			if (timeout !== null) clearTimeout(timeout);
		};
	});

	const statusLabel = $derived(
		status === 'running'
			? 'running'
			: status === 'starting'
				? 'starting…'
				: status === 'failed'
					? 'failed'
					: status === 'exited'
						? 'exited'
						: 'unknown'
	);

	const dotKind: SidecarStatusKind = $derived(
		status === 'running'
			? 'Running'
			: status === 'starting'
				? 'Starting'
				: status === 'failed'
					? 'Failed'
					: status === 'exited'
						? 'Exited'
						: 'NotStarted'
	);
</script>

<footer class="chimera-statusbar">
	<div class="chimera-statusbar__group">
		<span
			class="chimera-statusbar__dot"
			style:background={dotColor[dotKind]}
			title="sidecar status"
		></span>
		<span class="chimera-statusbar__label">sidecar</span>
		<span class="chimera-statusbar__value">{statusLabel}</span>
	</div>

	{#if baseUrl}
		<div class="chimera-statusbar__group">
			<Link2 size={12} />
			<span class="chimera-statusbar__value chimera-statusbar__value--mono">{baseUrl}</span>
		</div>
	{/if}

	{#if modelAlias}
		<div class="chimera-statusbar__group">
			<Circle size={10} />
			<span class="chimera-statusbar__label">model</span>
			<span class="chimera-statusbar__value chimera-statusbar__value--mono">{modelAlias}</span>
		</div>
	{/if}

	<div class="chimera-statusbar__spacer"></div>

	<a class="chimera-statusbar__link" href="#/chimera/chats">chats</a>
	<a class="chimera-statusbar__link" href="#/chimera/health">diagnostics</a>
</footer>

<style>
	.chimera-statusbar {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		padding: 0.4rem 1rem;
		font-size: 0.75rem;
		border-top: 1px solid var(--border, #333);
		background: var(--card, #1c1c1c);
		color: var(--muted-foreground, #999);
		flex-shrink: 0;
	}

	.chimera-statusbar__group {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.chimera-statusbar__dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
	}

	.chimera-statusbar__label {
		color: var(--muted-foreground, #888);
	}

	.chimera-statusbar__value {
		color: var(--foreground, #ccc);
	}

	.chimera-statusbar__value--mono {
		font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
		font-size: 0.7rem;
	}

	.chimera-statusbar__spacer {
		flex: 1;
	}

	.chimera-statusbar__link {
		color: var(--muted-foreground, #888);
		text-decoration: none;
		font-size: 0.7rem;
	}

	.chimera-statusbar__link:hover {
		color: var(--foreground, #ddd);
		text-decoration: underline;
	}
</style>
