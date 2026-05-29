import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	listStores,
	createStore,
	deleteStore,
	ingestText,
	ingestFile,
	search
} from './rag';

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
	const { ok = true, status = 200 } = init;
	return {
		ok,
		status,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
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

describe('rag client', () => {
	describe('listStores', () => {
		it('GETs /v1/vector_stores and returns the data array', async () => {
			const stores = [{ id: 'a', name: 'A' }];
			const fetchMock = stubFetch(() => jsonResponse({ data: stores }));
			const result = await listStores();
			expect(fetchMock).toHaveBeenCalledWith('/v1/vector_stores');
			expect(result).toEqual(stores);
		});

		it('returns [] when the response has no data field', async () => {
			stubFetch(() => jsonResponse({}));
			expect(await listStores()).toEqual([]);
		});
	});

	describe('createStore', () => {
		it('POSTs the name as JSON and returns the created store', async () => {
			const fetchMock = stubFetch(() => jsonResponse({ id: 'x', name: 'mine' }));
			const result = await createStore('mine');
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe('/v1/vector_stores');
			expect(init.method).toBe('POST');
			expect(JSON.parse(init.body as string)).toEqual({ name: 'mine' });
			expect(result).toEqual({ id: 'x', name: 'mine' });
		});
	});

	describe('deleteStore', () => {
		it('POSTs to the :name/delete path', async () => {
			const fetchMock = stubFetch(() => jsonResponse({}));
			await deleteStore('mine');
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe('/v1/vector_stores/mine/delete');
			expect(init.method).toBe('POST');
		});

		it('URL-encodes the store name', async () => {
			const fetchMock = stubFetch(() => jsonResponse({}));
			await deleteStore('my docs/v2');
			expect(fetchMock.mock.calls[0][0]).toBe('/v1/vector_stores/my%20docs%2Fv2/delete');
		});
	});

	describe('ingestText', () => {
		it('POSTs text without source_uri when omitted', async () => {
			const fetchMock = stubFetch(() => jsonResponse({ source_uri: '', chunks_inserted: 3 }));
			const result = await ingestText('store', 'hello world');
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe('/v1/vector_stores/store/files');
			expect(JSON.parse(init.body as string)).toEqual({ text: 'hello world' });
			expect(result.chunks_inserted).toBe(3);
		});

		it('includes source_uri when provided', async () => {
			const fetchMock = stubFetch(() => jsonResponse({ source_uri: 'src', chunks_inserted: 1 }));
			await ingestText('store', 'text', 'src');
			expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
				text: 'text',
				source_uri: 'src'
			});
		});
	});

	describe('ingestFile', () => {
		it('POSTs a multipart form with the file under its filename', async () => {
			const fetchMock = stubFetch(() => jsonResponse({ source_uri: 'a.txt', chunks_inserted: 2 }));
			const file = new File(['contents'], 'a.txt', { type: 'text/plain' });
			await ingestFile('store', file);
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe('/v1/vector_stores/store/files');
			expect(init.method).toBe('POST');
			expect(init.body).toBeInstanceOf(FormData);
			const sent = (init.body as FormData).get('file') as File;
			expect(sent.name).toBe('a.txt');
		});
	});

	describe('search', () => {
		it('defaults to k=5 and mode=hybrid', async () => {
			const fetchMock = stubFetch(() => jsonResponse({ data: [] }));
			await search('store', 'a query');
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe('/v1/vector_stores/store/search');
			expect(JSON.parse(init.body as string)).toEqual({ query: 'a query', k: 5, mode: 'hybrid' });
		});

		it('passes explicit k and mode and returns the hits', async () => {
			const hits = [{ document_id: 1, chunk_index: 0, text: 't' }];
			const fetchMock = stubFetch(() => jsonResponse({ data: hits }));
			const result = await search('store', 'q', 10, 'semantic');
			expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
				query: 'q',
				k: 10,
				mode: 'semantic'
			});
			expect(result).toEqual(hits);
		});

		it('returns [] when data is absent', async () => {
			stubFetch(() => jsonResponse({}));
			expect(await search('store', 'q')).toEqual([]);
		});
	});

	describe('error handling', () => {
		it('throws with status and detail on a non-ok response', async () => {
			stubFetch(() => jsonResponse('boom', { ok: false, status: 500 }));
			await expect(listStores()).rejects.toThrow(/HTTP 500: boom/);
		});

		it('throws with just the status when there is no detail body', async () => {
			stubFetch(() => jsonResponse('', { ok: false, status: 404 }));
			await expect(createStore('x')).rejects.toThrow(/HTTP 404/);
		});
	});
});
