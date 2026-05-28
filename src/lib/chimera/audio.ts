// chimera-desktop audio (speech-to-text) client.
//
// Talks to the chimera sidecar's OpenAI-compatible audio routes, which are
// only mounted when the sidecar was started with `--enable-audio <whisper>`
// (driven by CHIMERA_DESKTOP_AUDIO_MODEL; see src-tauri/src/sidecar.rs). Use
// `audioEnabled()` to check availability before offering the UI.
//
// Requests go through the global fetch wrapper installed in sidecar.ts, which
// rewrites the `/v1/...` path to the sidecar origin and routes it via the
// Tauri http plugin (bypassing the webview's CORS/COEP). We therefore call
// the bare relative path here and let the wrapper do the rest.

import { invoke } from '@tauri-apps/api/core';

export interface SidecarFeatures {
	audio: boolean;
}

// Verbose-json transcription shape (a superset of the default `{ text }`).
export interface TranscriptionResult {
	text: string;
	language?: string;
	duration?: number;
	segments?: Array<{ id: number; start: number; end: number; text: string }>;
}

export interface TranscribeOptions {
	// Translate to English (/v1/audio/translations) instead of transcribing
	// in the source language (/v1/audio/transcriptions).
	translate?: boolean;
}

// Whether the sidecar exposes the audio routes. Reflects the spawn-time
// --enable-audio flag, which /props does not advertise.
export async function audioEnabled(): Promise<boolean> {
	try {
		const features = await invoke<SidecarFeatures>('sidecar_features');
		return features?.audio === true;
	} catch {
		return false;
	}
}

// Transcribe (or translate) an audio file. Returns the verbose-json result so
// callers can show segments/duration if they want; the plain transcript is in
// `.text`. Throws on a non-2xx response with the server's error text.
export async function transcribeAudio(
	file: File,
	opts: TranscribeOptions = {}
): Promise<TranscriptionResult> {
	const path = opts.translate ? '/v1/audio/translations' : '/v1/audio/transcriptions';

	const form = new FormData();
	form.append('file', file, file.name);
	form.append('response_format', 'verbose_json');

	const res = await fetch(path, { method: 'POST', body: form });

	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
	}

	// chimera returns verbose_json here, but tolerate a plain `{ text }` body.
	return (await res.json()) as TranscriptionResult;
}
