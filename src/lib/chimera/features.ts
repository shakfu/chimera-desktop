// Optional sidecar modality routes, as reported by the Rust `sidecar_features`
// command. These reflect the spawn-time `--enable-*` flags, which the webview
// can't infer from /props (its `modalities` field describes the chat model's
// multimodal *inputs*, not the standalone audio/image routes). Mirror the
// SidecarFeatures struct in src-tauri/src/sidecar.rs.

import { invoke } from '@tauri-apps/api/core';

export interface SidecarFeatures {
	audio: boolean;
	image: boolean;
	rag: boolean;
	rerank: boolean;
}

const NONE: SidecarFeatures = { audio: false, image: false, rag: false, rerank: false };

// Fetch the enabled modality routes. Returns everything-disabled if the
// command is unavailable (e.g. running in a plain browser via vite-dev).
export async function sidecarFeatures(): Promise<SidecarFeatures> {
	try {
		return { ...NONE, ...(await invoke<SidecarFeatures>('sidecar_features')) };
	} catch {
		return NONE;
	}
}
