// What the sidecar was started with, as reported by the Rust
// `sidecar_features` command: the optional modality routes, plus the
// spawn-time options that change how an enabled route behaves. These reflect
// the flags passed to `serve`, which the webview can't infer from /props (its
// `modalities` field describes the chat model's multimodal *inputs*, not the
// standalone audio/image routes). Mirror the SidecarFeatures struct in
// src-tauri/src/sidecar.rs.

import { invoke } from '@tauri-apps/api/core';

export interface SidecarFeatures {
	audio: boolean;
	image: boolean;
	rag: boolean;
	rerank: boolean;
	lora: boolean;
	// Not a route: --sd-eager-load was passed, so the diffusion weights were
	// uploaded at model-load time and the first image generation skips the
	// warmup. Always false when `image` is false.
	sdEagerLoad: boolean;
}

const NONE: SidecarFeatures = {
	audio: false,
	image: false,
	rag: false,
	rerank: false,
	lora: false,
	sdEagerLoad: false
};

// Fetch the enabled modality routes. Returns everything-disabled if the
// command is unavailable (e.g. running in a plain browser via vite-dev).
export async function sidecarFeatures(): Promise<SidecarFeatures> {
	try {
		return { ...NONE, ...(await invoke<SidecarFeatures>('sidecar_features')) };
	} catch {
		return NONE;
	}
}
