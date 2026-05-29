import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateImage } from './image';

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

function bodyOf(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
	return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('generateImage', () => {
	it('POSTs to /v1/images/generations with only prompt + b64_json when minimal', async () => {
		const fetchMock = stubFetch(() => jsonResponse({ data: [] }));
		await generateImage({ prompt: 'a cat' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/v1/images/generations');
		expect(init.method).toBe('POST');
		expect(bodyOf(fetchMock)).toEqual({ prompt: 'a cat', response_format: 'b64_json' });
	});

	it('maps optional fields to their server keys when provided', async () => {
		const fetchMock = stubFetch(() => jsonResponse({ data: [] }));
		await generateImage({
			prompt: 'p',
			negativePrompt: 'blurry',
			size: '512x512',
			steps: 4,
			cfgScale: 1.5,
			seed: 42,
			n: 2
		});
		expect(bodyOf(fetchMock)).toEqual({
			prompt: 'p',
			response_format: 'b64_json',
			negative_prompt: 'blurry',
			size: '512x512',
			steps: 4,
			cfg_scale: 1.5,
			seed: 42,
			n: 2
		});
	});

	it('includes seed 0 and steps 0 (uses != null, not falsy checks)', async () => {
		const fetchMock = stubFetch(() => jsonResponse({ data: [] }));
		await generateImage({ prompt: 'p', seed: 0, steps: 0 });
		const body = bodyOf(fetchMock);
		expect(body.seed).toBe(0);
		expect(body.steps).toBe(0);
	});

	it('omits seed when explicitly null', async () => {
		const fetchMock = stubFetch(() => jsonResponse({ data: [] }));
		await generateImage({ prompt: 'p', seed: null });
		expect('seed' in bodyOf(fetchMock)).toBe(false);
	});

	it('returns the b64_json strings from the response data', async () => {
		stubFetch(() => jsonResponse({ data: [{ b64_json: 'AAAA' }, { b64_json: 'BBBB' }] }));
		expect(await generateImage({ prompt: 'p' })).toEqual(['AAAA', 'BBBB']);
	});

	it('filters out entries with no b64_json and tolerates missing data', async () => {
		stubFetch(() => jsonResponse({ data: [{ b64_json: 'AAAA' }, {}, { b64_json: '' }] }));
		expect(await generateImage({ prompt: 'p' })).toEqual(['AAAA']);
		stubFetch(() => jsonResponse({}));
		expect(await generateImage({ prompt: 'p' })).toEqual([]);
	});

	it('throws with status and detail on a non-ok response', async () => {
		stubFetch(() => jsonResponse('no sd model', { ok: false, status: 503 }));
		await expect(generateImage({ prompt: 'p' })).rejects.toThrow(/HTTP 503: no sd model/);
	});
});
