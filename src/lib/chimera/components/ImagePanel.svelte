<script lang="ts">
	// Image (text-to-image) panel body for the right rail. Sends a prompt to
	// the chimera sidecar's stable-diffusion route and renders the result(s).
	import { Image as ImageIcon, Loader2, Download, Dice5 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { generateImage } from '$lib/chimera/image';

	// null = still probing (owned by RightRail's one-shot feature fetch).
	let { enabled = null }: { enabled?: boolean | null } = $props();

	const SIZES = ['512x512', '768x768', '1024x1024'];

	let prompt = $state('');
	let negativePrompt = $state('');
	let size = $state('512x512');
	// Defaults tuned for the few-step turbo models in models/ (sd_xl_turbo,
	// z_image_turbo): low steps, cfg ~1. Bump steps/cfg for non-turbo models.
	let steps = $state(4);
	let cfgScale = $state(1);
	let seedText = $state('');
	let busy = $state(false);
	let images = $state<string[]>([]);
	let error = $state<string | null>(null);

	let canRun = $derived(prompt.trim().length > 0 && !busy);

	async function run() {
		if (!canRun) return;
		busy = true;
		error = null;
		images = [];
		const seedTrim = seedText.trim();
		const seed = seedTrim === '' ? null : Number(seedTrim);
		try {
			images = await generateImage({
				prompt: prompt.trim(),
				negativePrompt: negativePrompt.trim() || undefined,
				size,
				steps,
				cfgScale,
				seed: seed != null && Number.isFinite(seed) ? seed : null
			});
			if (images.length === 0) error = 'No image returned.';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	function randomizeSeed() {
		seedText = String(Math.floor(Math.random() * 2 ** 31));
	}

	function download(b64: string, i: number) {
		const a = document.createElement('a');
		a.href = `data:image/png;base64,${b64}`;
		a.download = `chimera-${Date.now()}-${i}.png`;
		a.click();
	}
</script>

<p class="text-sm text-muted-foreground">Generate an image from a text prompt via stable-diffusion.</p>

{#if enabled === null}
	<div class="flex items-center gap-2 text-sm text-muted-foreground">
		<Loader2 class="size-4 animate-spin" />
		Checking availability…
	</div>
{:else if enabled === false}
	<div class="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
		<p class="mb-1 font-medium text-foreground">Image route not enabled</p>
		<p class="leading-relaxed">
			Start the sidecar with a stable-diffusion model to enable generation. Set
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs">CHIMERA_DESKTOP_IMAGE_MODEL</code>
			to an SD <code class="rounded bg-background px-1 py-0.5 font-mono text-xs">.gguf</code>, or run
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs">make dev</code> with a model present
			at
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs"
				>models/sd_xl_turbo_1.0.q8_0.gguf</code
			>.
		</p>
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<div class="flex flex-col gap-2">
			<Label for="img-prompt">Prompt</Label>
			<Textarea
				id="img-prompt"
				bind:value={prompt}
				placeholder="a red apple on a wooden table, studio lighting"
				rows={3}
			/>
		</div>

		<div class="flex flex-col gap-2">
			<Label for="img-neg">Negative prompt <span class="text-muted-foreground">(optional)</span></Label>
			<Textarea id="img-neg" bind:value={negativePrompt} placeholder="blurry, low quality" rows={2} />
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div class="flex flex-col gap-2">
				<Label for="img-size">Size</Label>
				<select
					id="img-size"
					bind:value={size}
					class="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					{#each SIZES as s (s)}
						<option value={s}>{s}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-2">
				<Label for="img-steps">Steps</Label>
				<Input id="img-steps" type="number" min={1} max={100} bind:value={steps} />
			</div>
			<div class="flex flex-col gap-2">
				<Label for="img-cfg">CFG scale</Label>
				<Input id="img-cfg" type="number" min={0} max={30} step={0.5} bind:value={cfgScale} />
			</div>
			<div class="flex flex-col gap-2">
				<Label for="img-seed">Seed <span class="text-muted-foreground">(random)</span></Label>
				<div class="flex gap-1">
					<Input id="img-seed" type="text" inputmode="numeric" placeholder="random" bind:value={seedText} />
					<Button variant="outline" size="icon" aria-label="Random seed" onclick={randomizeSeed}>
						<Dice5 class="size-4" />
					</Button>
				</div>
			</div>
		</div>

		<Button size="sm" disabled={!canRun} onclick={run}>
			{#if busy}
				<Loader2 class="size-4 animate-spin" />
				Generating…
			{:else}
				<ImageIcon class="size-4" />
				Generate
			{/if}
		</Button>

		{#if error}
			<div
				class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
			>
				{error}
			</div>
		{/if}

		{#if images.length}
			<div class="flex flex-col gap-3">
				{#each images as b64, i (i)}
					<div class="group relative overflow-hidden rounded-md border border-border">
						<img src="data:image/png;base64,{b64}" alt="Generated result {i + 1}" class="w-full" />
						<Button
							variant="secondary"
							size="icon-sm"
							class="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
							aria-label="Download image"
							onclick={() => download(b64, i)}
						>
							<Download class="size-4" />
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
