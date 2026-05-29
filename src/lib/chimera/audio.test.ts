import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcribeAudio } from './audio';

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

const wav = () => new File([new Uint8Array([1, 2, 3])], 'clip.wav', { type: 'audio/wav' });

describe('transcribeAudio', () => {
	it('POSTs to /v1/audio/transcriptions by default', async () => {
		const fetchMock = stubFetch(() => jsonResponse({ text: 'hello' }));
		const result = await transcribeAudio(wav());
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/v1/audio/transcriptions');
		expect(init.method).toBe('POST');
		expect(result.text).toBe('hello');
	});

	it('POSTs to /v1/audio/translations when translate is set', async () => {
		const fetchMock = stubFetch(() => jsonResponse({ text: 'bonjour -> hello' }));
		await transcribeAudio(wav(), { translate: true });
		expect(fetchMock.mock.calls[0][0]).toBe('/v1/audio/translations');
	});

	it('sends the file and requests verbose_json', async () => {
		const fetchMock = stubFetch(() => jsonResponse({ text: 't' }));
		await transcribeAudio(wav());
		const form = fetchMock.mock.calls[0][1].body as FormData;
		expect(form).toBeInstanceOf(FormData);
		expect(form.get('response_format')).toBe('verbose_json');
		expect((form.get('file') as File).name).toBe('clip.wav');
	});

	it('returns the parsed verbose-json (segments, language, duration)', async () => {
		stubFetch(() =>
			jsonResponse({
				text: 'full',
				language: 'en',
				duration: 1.5,
				segments: [{ id: 0, start: 0, end: 1.5, text: 'full' }]
			})
		);
		const result = await transcribeAudio(wav());
		expect(result.language).toBe('en');
		expect(result.segments).toHaveLength(1);
	});

	it('throws with status and detail on a non-ok response', async () => {
		stubFetch(() => jsonResponse('model missing', { ok: false, status: 503 }));
		await expect(transcribeAudio(wav())).rejects.toThrow(/HTTP 503: model missing/);
	});
});
