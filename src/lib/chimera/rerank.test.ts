import { afterEach, describe, expect, it, vi } from 'vitest';
import { rerank } from './rerank';

// Build a Response-like stub for the global fetch mock. rerank() only touches
// res.ok, res.status, res.json(), and (on error) res.text().
function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
	const { ok = true, status = 200 } = init;
	return {
		ok,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body)
	} as Response;
}

function stubFetch(impl: (url: string, init: RequestInit) => Response) {
	const fn = vi.fn(async (url: string, init: RequestInit) => impl(url, init));
	vi.stubGlobal('fetch', fn);
	return fn;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const DOCS = ['doc-a', 'doc-b', 'doc-c'];

describe('rerank', () => {
	it('sorts results by descending relevance_score regardless of server order', async () => {
		// Server returns out-of-order (and not by index): b highest, then a, then c.
		stubFetch(() =>
			jsonResponse({
				results: [
					{ index: 2, relevance_score: -3.5 },
					{ index: 0, relevance_score: 1.2 },
					{ index: 1, relevance_score: 9.9 }
				]
			})
		);

		const ranked = await rerank('q', DOCS);

		expect(ranked.map((r) => r.index)).toEqual([1, 0, 2]);
		expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
		expect(ranked.map((r) => r.document)).toEqual(['doc-b', 'doc-a', 'doc-c']);
		expect(ranked.map((r) => r.score)).toEqual([9.9, 1.2, -3.5]);
	});

	it('maps each result index back to its original document text', async () => {
		stubFetch(() =>
			jsonResponse({
				results: [
					{ index: 0, relevance_score: 5 },
					{ index: 1, relevance_score: 4 },
					{ index: 2, relevance_score: 3 }
				]
			})
		);

		const ranked = await rerank('q', DOCS);
		for (const r of ranked) {
			expect(r.document).toBe(DOCS[r.index]);
		}
	});

	it('sends the expected request body and defaults top_n to the document count', async () => {
		const fetchMock = stubFetch(() => jsonResponse({ results: [] }));

		await rerank('what is x?', DOCS);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/v1/rerank');
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
		expect(JSON.parse(init.body as string)).toEqual({
			model: 'any',
			query: 'what is x?',
			documents: DOCS,
			top_n: 3
		});
	});

	it('passes an explicit top_n through to the request', async () => {
		const fetchMock = stubFetch(() => jsonResponse({ results: [] }));

		await rerank('q', DOCS, 2);

		expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).top_n).toBe(2);
	});

	it('drops results whose index is out of range', async () => {
		stubFetch(() =>
			jsonResponse({
				results: [
					{ index: 0, relevance_score: 1 },
					{ index: 5, relevance_score: 99 }, // out of range -> dropped
					{ index: -1, relevance_score: 50 } // out of range -> dropped
				]
			})
		);

		const ranked = await rerank('q', DOCS);
		expect(ranked).toHaveLength(1);
		expect(ranked[0].index).toBe(0);
	});

	it('returns an empty array when the response has no results field', async () => {
		stubFetch(() => jsonResponse({}));
		expect(await rerank('q', DOCS)).toEqual([]);
	});

	it('throws with status and detail when the response is not ok', async () => {
		stubFetch(() => jsonResponse({ error: 'rerank route not enabled' }, { ok: false, status: 404 }));
		await expect(rerank('q', DOCS)).rejects.toThrow(/HTTP 404/);
	});
});
