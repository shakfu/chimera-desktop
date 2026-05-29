// chimera-desktop LoRA (adapter hot-swap) client.
//
// Talks to the sidecar's `/lora-adapters` routes. Unlike the other modality
// routes, `/lora-adapters` is ALWAYS mounted by chimera — but it only lists /
// acts on adapters that were loaded at spawn time via `--lora path[:scale]`
// (driven here by CHIMERA_DESKTOP_LORA; see src-tauri/src/sidecar.rs). New
// adapter files cannot be added at runtime; POST only re-weights the loaded
// set (scale 0 disables one) without a model reload. `loraEnabled()` reflects
// whether any adapter was loaded at spawn.
//
// Requests go through the global fetch wrapper in sidecar.ts (which rewrites
// `/lora-adapters` to the sidecar origin and routes via the Tauri http plugin,
// bypassing the webview CORS/COEP).

import { sidecarFeatures } from './features';

export interface LoraAdapter {
	id: number;
	path: string;
	scale: number;
}

// A scale change to apply. `id` indexes into the loaded `--lora` list.
export interface LoraScale {
	id: number;
	scale: number;
}

export async function loraEnabled(): Promise<boolean> {
	return (await sidecarFeatures()).lora;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
	}
	return (await res.json()) as T;
}

// List the loaded adapters and their current scales. Returns [] when none were
// loaded at spawn (the route is mounted regardless).
export async function listAdapters(): Promise<LoraAdapter[]> {
	const res = await fetch('/lora-adapters');
	const body = await jsonOrThrow<LoraAdapter[]>(res);
	return Array.isArray(body) ? body : [];
}

// Re-weight which adapters apply to subsequent requests. The body is the full
// array of {id, scale}; ids omitted are left untouched by chimera, but the
// panel always sends every row so the request is unambiguous. chimera echoes
// the updated list back; we tolerate a non-array body by returning [].
export async function setScales(scales: LoraScale[]): Promise<LoraAdapter[]> {
	const res = await fetch('/lora-adapters', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(scales)
	});
	const body = await jsonOrThrow<LoraAdapter[] | unknown>(res);
	return Array.isArray(body) ? (body as LoraAdapter[]) : [];
}
