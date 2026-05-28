// chimera-desktop RAG (vector store) client.
//
// Talks to the sidecar's OpenAI-shaped `/v1/vector_stores/*` routes, mounted
// only when the sidecar was started with `--enable-rag <embed.gguf>` (driven
// by CHIMERA_DESKTOP_RAG_MODEL; see src-tauri/src/sidecar.rs). Use
// `ragEnabled()` to check availability.
//
// Requests go through the global fetch wrapper in sidecar.ts (which rewrites
// `/v1/...` to the sidecar origin and routes via the Tauri http plugin,
// bypassing the webview CORS/COEP). Note chimera drops a collection via
// POST /:name/delete, not HTTP DELETE.

import { sidecarFeatures } from './features';

export interface VectorStore {
	id: string;
	name: string;
	created_at: number;
	file_counts: { completed: number; total: number };
	meta: {
		embedding_model: string;
		dim: number;
		distance: string;
		chunk_tokens: number;
		chunk_overlap: number;
	};
}

export type SearchMode = 'hybrid' | 'semantic' | 'lexical';

export interface SearchHit {
	document_id: number;
	source_uri: string;
	chunk_index: number;
	text: string;
	distance: number;
	rrf_score?: number;
	semantic_rank?: number;
	lexical_rank?: number;
}

export async function ragEnabled(): Promise<boolean> {
	return (await sidecarFeatures()).rag;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
	}
	return (await res.json()) as T;
}

export async function listStores(): Promise<VectorStore[]> {
	const res = await fetch('/v1/vector_stores');
	const body = await jsonOrThrow<{ data?: VectorStore[] }>(res);
	return body.data ?? [];
}

export async function createStore(name: string): Promise<VectorStore> {
	const res = await fetch('/v1/vector_stores', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name })
	});
	return jsonOrThrow<VectorStore>(res);
}

export async function deleteStore(name: string): Promise<void> {
	const res = await fetch(`/v1/vector_stores/${encodeURIComponent(name)}/delete`, {
		method: 'POST'
	});
	await jsonOrThrow<unknown>(res);
}

export interface IngestResult {
	source_uri: string;
	chunks_inserted: number;
}

// Ingest a block of text (chunked + embedded server-side). `sourceUri` is an
// optional label stored with each chunk and shown in search results.
export async function ingestText(
	name: string,
	text: string,
	sourceUri?: string
): Promise<IngestResult> {
	const res = await fetch(`/v1/vector_stores/${encodeURIComponent(name)}/files`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ text, ...(sourceUri ? { source_uri: sourceUri } : {}) })
	});
	return jsonOrThrow<IngestResult>(res);
}

// Ingest a file via multipart upload (its filename becomes the source_uri).
export async function ingestFile(name: string, file: File): Promise<IngestResult> {
	const form = new FormData();
	form.append('file', file, file.name);
	const res = await fetch(`/v1/vector_stores/${encodeURIComponent(name)}/files`, {
		method: 'POST',
		body: form
	});
	return jsonOrThrow<IngestResult>(res);
}

export async function search(
	name: string,
	query: string,
	k = 5,
	mode: SearchMode = 'hybrid'
): Promise<SearchHit[]> {
	const res = await fetch(`/v1/vector_stores/${encodeURIComponent(name)}/search`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, k, mode })
	});
	const body = await jsonOrThrow<{ data?: SearchHit[] }>(res);
	return body.data ?? [];
}
