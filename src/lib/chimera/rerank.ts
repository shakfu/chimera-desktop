// chimera-desktop cross-encoder rerank client.
//
// Talks to the sidecar's `/v1/rerank` route, mounted only when the sidecar
// was started with `--reranking <rerank.gguf>` (driven by
// CHIMERA_DESKTOP_RERANK_MODEL; see src-tauri/src/sidecar.rs). Use
// `rerankEnabled()` to check availability.
//
// Requests go through the global fetch wrapper in sidecar.ts (which rewrites
// `/v1/...` to the sidecar origin and routes via the Tauri http plugin,
// bypassing the webview CORS/COEP).
//
// The endpoint is upstream llama-server's OpenAI-Cohere-shaped reranker:
// request {query, documents, top_n}, response {results: [{index,
// relevance_score}]}. The `results` array is keyed by the *input* document
// index and is NOT guaranteed sorted, so we join each score back to its
// document text and sort descending here.

import { sidecarFeatures } from './features';

export async function rerankEnabled(): Promise<boolean> {
	return (await sidecarFeatures()).rerank;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
	}
	return (await res.json()) as T;
}

// One scored, ranked document: its original (pre-sort) position, the document
// text, the raw cross-encoder relevance score, and its 1-based rank after
// sorting. `score` is a raw logit — it has no fixed range and may be negative;
// only the relative ordering is meaningful.
export interface RankedDocument {
	index: number;
	document: string;
	score: number;
	rank: number;
}

interface RerankResult {
	index: number;
	relevance_score: number;
}

interface RerankResponse {
	results?: RerankResult[];
}

// Rerank `documents` against `query`, returning all of them sorted by
// descending relevance. `topN` caps how many the server scores+returns
// (defaults to all documents); the result is sorted client-side regardless.
export async function rerank(
	query: string,
	documents: string[],
	topN?: number
): Promise<RankedDocument[]> {
	const res = await fetch('/v1/rerank', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: 'any',
			query,
			documents,
			top_n: topN ?? documents.length
		})
	});
	const body = await jsonOrThrow<RerankResponse>(res);
	return (body.results ?? [])
		.filter((r) => r.index >= 0 && r.index < documents.length)
		.sort((a, b) => b.relevance_score - a.relevance_score)
		.map((r, i) => ({
			index: r.index,
			document: documents[r.index],
			score: r.relevance_score,
			rank: i + 1
		}));
}
