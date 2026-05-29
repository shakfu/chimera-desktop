import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAdapters, setScales } from './lora';

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

const ADAPTERS = [
	{ id: 0, path: '/models/a.gguf', scale: 1 },
	{ id: 1, path: '/models/b.gguf', scale: 0.5 }
];

describe('lora client', () => {
	describe('listAdapters', () => {
		it('GETs /lora-adapters and returns the array', async () => {
			const fetchMock = stubFetch(() => jsonResponse(ADAPTERS));
			const result = await listAdapters();
			expect(fetchMock).toHaveBeenCalledWith('/lora-adapters');
			expect(result).toEqual(ADAPTERS);
		});

		it('returns [] when the body is not an array', async () => {
			stubFetch(() => jsonResponse({ error: 'unexpected' }));
			expect(await listAdapters()).toEqual([]);
		});
	});

	describe('setScales', () => {
		it('POSTs the scales array to /lora-adapters', async () => {
			const fetchMock = stubFetch(() => jsonResponse(ADAPTERS));
			await setScales([
				{ id: 0, scale: 0.8 },
				{ id: 1, scale: 0 }
			]);
			const [url, init] = fetchMock.mock.calls[0];
			expect(url).toBe('/lora-adapters');
			expect(init.method).toBe('POST');
			expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
			expect(JSON.parse(init.body as string)).toEqual([
				{ id: 0, scale: 0.8 },
				{ id: 1, scale: 0 }
			]);
		});

		it('returns the echoed adapter list', async () => {
			stubFetch(() => jsonResponse(ADAPTERS));
			expect(await setScales([{ id: 0, scale: 1 }])).toEqual(ADAPTERS);
		});

		it('returns [] when the response is not an array', async () => {
			stubFetch(() => jsonResponse({ ok: true }));
			expect(await setScales([{ id: 0, scale: 1 }])).toEqual([]);
		});
	});

	describe('error handling', () => {
		it('throws with status and detail on a non-ok response', async () => {
			stubFetch(() => jsonResponse('no adapters', { ok: false, status: 400 }));
			await expect(listAdapters()).rejects.toThrow(/HTTP 400: no adapters/);
		});
	});
});
