// chimera-desktop image (text-to-image) client.
//
// Talks to the sidecar's OpenAI-compatible `/v1/images/generations` route,
// which is only mounted when the sidecar was started with
// `--enable-image <sd.gguf>` (driven by CHIMERA_DESKTOP_IMAGE_MODEL; see
// src-tauri/src/sidecar.rs). Use `imageEnabled()` to check availability.
//
// Requests go through the global fetch wrapper in sidecar.ts, which rewrites
// the `/v1/...` path to the sidecar origin and routes it via the Tauri http
// plugin (bypassing the webview's CORS/COEP). Generation can take many
// seconds; there is no client-side timeout.

import { sidecarFeatures } from './features';

export interface GenerateOptions {
	prompt: string;
	negativePrompt?: string;
	// "<W>x<H>", e.g. "512x512".
	size?: string;
	steps?: number;
	cfgScale?: number;
	// Omit / null for a random seed.
	seed?: number | null;
	// Number of images (batch_count).
	n?: number;
}

// Whether the sidecar exposes the image route. Reflects the spawn-time
// --enable-image flag, which /props does not advertise.
export async function imageEnabled(): Promise<boolean> {
	return (await sidecarFeatures()).image;
}

// Generate one or more images. Returns base64-encoded PNGs (chimera only
// supports response_format=b64_json — it has no static-file backend for URLs).
// Throws on a non-2xx response with the server's error text.
export async function generateImage(opts: GenerateOptions): Promise<string[]> {
	const body: Record<string, unknown> = {
		prompt: opts.prompt,
		response_format: 'b64_json'
	};
	if (opts.negativePrompt) body.negative_prompt = opts.negativePrompt;
	if (opts.size) body.size = opts.size;
	if (opts.steps != null) body.steps = opts.steps;
	if (opts.cfgScale != null) body.cfg_scale = opts.cfgScale;
	if (opts.seed != null) body.seed = opts.seed;
	if (opts.n != null) body.n = opts.n;

	const res = await fetch('/v1/images/generations', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
	}

	const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
	return (json.data ?? []).map((d) => d.b64_json ?? '').filter(Boolean);
}
