<script lang="ts">
	// LoRA adapter panel body for the right rail. Lists the adapters loaded at
	// spawn via `--lora` and lets you re-weight them (scale 0 disables) and
	// apply the new scales without a model reload, through the sidecar's
	// /lora-adapters routes. New adapter files cannot be added at runtime.
	import { Loader2, Layers, RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { listAdapters, setScales, type LoraAdapter } from '$lib/chimera/lora';

	// null = still probing (owned by RightRail's one-shot feature fetch).
	let { enabled = null }: { enabled?: boolean | null } = $props();

	let adapters = $state<LoraAdapter[]>([]);
	// Editable scales, parallel to `adapters`. Diverges from the server values
	// until Apply (or Reset) reconciles them.
	let scales = $state<number[]>([]);
	let loading = $state(false);
	let applying = $state(false);
	let error = $state<string | null>(null);
	let loadedOnce = false;

	let dirty = $derived(adapters.some((a, i) => a.scale !== scales[i]));

	$effect(() => {
		if (enabled === true && !loadedOnce) {
			loadedOnce = true;
			refresh();
		}
	});

	async function refresh() {
		loading = true;
		error = null;
		try {
			adapters = await listAdapters();
			scales = adapters.map((a) => a.scale);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function apply() {
		if (applying || !adapters.length) return;
		applying = true;
		error = null;
		try {
			const updated = await setScales(adapters.map((a, i) => ({ id: a.id, scale: scales[i] })));
			adapters = updated.length ? updated : await listAdapters();
			scales = adapters.map((a) => a.scale);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			applying = false;
		}
	}

	function reset() {
		scales = adapters.map((a) => a.scale);
	}

	function basename(p: string): string {
		return p.split(/[\\/]/).pop() || p;
	}
</script>

<p class="text-sm text-muted-foreground">
	Re-weight the LoRA adapters loaded at startup and apply the new scales without a model reload. Set
	a scale to 0 to disable an adapter.
</p>

{#if enabled === null}
	<div class="flex items-center gap-2 text-sm text-muted-foreground">
		<Loader2 class="size-4 animate-spin" />
		Checking availability…
	</div>
{:else if enabled === false}
	<div class="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
		<p class="mb-1 font-medium text-foreground">No LoRA adapters loaded</p>
		<p class="leading-relaxed">
			Adapters must be loaded when the sidecar starts — they cannot be added at runtime. Set
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs">CHIMERA_DESKTOP_LORA</code>
			to a comma-separated list of
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs">path[:scale]</code>
			entries (or run <code class="rounded bg-background px-1 py-0.5 font-mono text-xs">make LORA=…</code
			>). Adapters must match the loaded base model.
		</p>
	</div>
{:else if loading}
	<div class="flex items-center gap-2 text-sm text-muted-foreground">
		<Loader2 class="size-4 animate-spin" /> Loading adapters…
	</div>
{:else if adapters.length === 0}
	<p class="text-sm text-muted-foreground">No adapters reported by the sidecar.</p>
{:else}
	<div class="flex flex-col gap-4">
		<section class="flex flex-col gap-3">
			{#each adapters as adapter, i (adapter.id)}
				<div class="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5">
					<div class="flex items-center justify-between gap-2">
						<span class="truncate font-mono text-xs text-card-foreground" title={adapter.path}>
							{basename(adapter.path)}
						</span>
						<span class="shrink-0 font-mono text-xs text-muted-foreground">{scales[i].toFixed(2)}</span>
					</div>
					<input
						type="range"
						min="0"
						max="2"
						step="0.05"
						bind:value={scales[i]}
						aria-label={`Scale for ${basename(adapter.path)}`}
						class="w-full accent-primary"
					/>
				</div>
			{/each}
		</section>

		<div class="flex gap-1">
			<Button size="sm" class="flex-1" disabled={!dirty || applying} onclick={apply}>
				{#if applying}<Loader2 class="size-4 animate-spin" /> Applying…{:else}<Layers class="size-4" /> Apply{/if}
			</Button>
			<Button variant="outline" size="sm" disabled={!dirty || applying} onclick={reset}>
				<RotateCcw class="size-4" /> Reset
			</Button>
		</div>
		{#if error}<p class="text-xs text-destructive">{error}</p>{/if}
	</div>
{/if}
