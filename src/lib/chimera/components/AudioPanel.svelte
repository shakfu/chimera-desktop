<script lang="ts">
	// Audio (speech-to-text) panel body for the right rail. Picks a local
	// audio file and runs it through the chimera sidecar's whisper route,
	// either transcribing in-language or translating to English.
	import { AudioLines, Copy, Check, Loader2, FileAudio } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import { transcribeAudio, type TranscriptionResult } from '$lib/chimera/audio';

	// null = still probing (owned by RightRail's one-shot feature fetch).
	let { enabled = null }: { enabled?: boolean | null } = $props();

	let files = $state<FileList | undefined>(undefined);
	let translate = $state(false);
	let busy = $state(false);
	let result = $state<TranscriptionResult | null>(null);
	let error = $state<string | null>(null);
	let copied = $state(false);

	let file = $derived(files?.[0] ?? null);

	async function run() {
		if (!file || busy) return;
		busy = true;
		error = null;
		result = null;
		copied = false;
		try {
			result = await transcribeAudio(file, { translate });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function copyText() {
		if (!result?.text) return;
		try {
			await navigator.clipboard.writeText(result.text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard may be unavailable; ignore */
		}
	}

	function fmtDuration(s: number | undefined): string {
		if (s == null) return '';
		const m = Math.floor(s / 60);
		const sec = Math.round(s % 60);
		return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
	}
</script>

<p class="text-sm text-muted-foreground">
	Transcribe a local audio file via whisper, or translate it to English.
</p>

{#if enabled === null}
	<div class="flex items-center gap-2 text-sm text-muted-foreground">
		<Loader2 class="size-4 animate-spin" />
		Checking availability…
	</div>
{:else if enabled === false}
	<div class="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
		<p class="mb-1 font-medium text-foreground">Audio route not enabled</p>
		<p class="leading-relaxed">
			Start the sidecar with a whisper model to enable transcription. Set
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs">CHIMERA_DESKTOP_AUDIO_MODEL</code>
			to a whisper <code class="rounded bg-background px-1 py-0.5 font-mono text-xs">.bin</code>/<code
				class="rounded bg-background px-1 py-0.5 font-mono text-xs">.gguf</code
			>, or run
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs">make dev</code> with a model present
			at
			<code class="rounded bg-background px-1 py-0.5 font-mono text-xs">models/ggml-base.en.bin</code>.
		</p>
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<div class="flex flex-col gap-2">
			<Label for="audio-file">Audio file</Label>
			<Input id="audio-file" type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg" bind:files />
			{#if file}
				<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<FileAudio class="size-3.5" />
					{file.name}
				</p>
			{/if}
		</div>

		<div class="flex items-center justify-between">
			<Label for="audio-translate" class="cursor-pointer">Translate to English</Label>
			<Switch id="audio-translate" bind:checked={translate} />
		</div>

		<Button size="sm" disabled={!file || busy} onclick={run}>
			{#if busy}
				<Loader2 class="size-4 animate-spin" />
				{translate ? 'Translating…' : 'Transcribing…'}
			{:else}
				<AudioLines class="size-4" />
				{translate ? 'Translate' : 'Transcribe'}
			{/if}
		</Button>

		{#if error}
			<div
				class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
			>
				{error}
			</div>
		{/if}

		{#if result}
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						{translate ? 'Translation' : 'Transcript'}
					</span>
					<Button variant="ghost" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={copyText}>
						{#if copied}<Check class="size-3.5" /> Copied{:else}<Copy class="size-3.5" /> Copy{/if}
					</Button>
				</div>
				<div
					class="max-h-64 overflow-y-auto rounded-md border border-border bg-card p-3 text-sm leading-relaxed whitespace-pre-wrap text-card-foreground"
				>
					{result.text?.trim() || '(empty result)'}
				</div>
				{#if result.duration != null}
					<p class="text-xs text-muted-foreground">
						{fmtDuration(result.duration)}
						{#if result.segments?.length}
							· {result.segments.length} segment{result.segments.length === 1 ? '' : 's'}
						{/if}
					</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}
