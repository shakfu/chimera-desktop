import { afterEach, describe, expect, it, vi } from 'vitest';

// Integration-style tests for the global fetch wrapper. sidecar.ts keeps
// module-level singletons (installed guard, chimeraBase, the baseReady
// promise) and rebinds globalThis.fetch, so each case gets a fresh module via
// vi.resetModules() + dynamic import, with the two Tauri packages mocked.

const SELF_ORIGIN = 'http://localhost:1420';
const CHAT_ID_KEY = 'chimera.chatIds.v1';

function fakeLocalStorage() {
	const store = new Map<string, string>();
	return {
		getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear()
	};
}

type TauriFetch = (url: string, init?: RequestInit) => Response | Promise<Response>;

async function setup(opts: { port?: number | null; tauriFetch?: TauriFetch } = {}) {
	const { port = 8080 } = opts;
	vi.resetModules();

	const invoke = vi.fn(async () => port);
	const impl: TauriFetch = opts.tauriFetch ?? (() => new Response('chimera-ok', { status: 200 }));
	const tauriFetch = vi.fn((url: string, init?: RequestInit) => impl(url, init));
	vi.doMock('@tauri-apps/api/core', () => ({ invoke }));
	vi.doMock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetch }));

	const origFetch = vi.fn((url?: unknown, _init?: unknown) =>
		Promise.resolve(new Response('orig-ok', { status: 200 }))
	);
	const localStorage = fakeLocalStorage();
	vi.stubGlobal('fetch', origFetch);
	vi.stubGlobal('window', { location: { origin: SELF_ORIGIN }, localStorage });
	vi.stubGlobal('localStorage', localStorage);

	const mod = await import('./sidecar');
	mod.installChimeraFetch();
	await mod.resolveChimeraSidecar();

	// globalThis.fetch is now the wrapper; expose it explicitly for clarity.
	return { mod, invoke, tauriFetch, origFetch, localStorage, fetch: globalThis.fetch };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
	vi.restoreAllMocks();
});

describe('chimera fetch wrapper — routing', () => {
	it('rewrites a relative chimera path to the sidecar origin and uses the Tauri fetch', async () => {
		const { fetch, tauriFetch, origFetch } = await setup({ port: 8080 });
		await fetch('/v1/models');
		expect(tauriFetch).toHaveBeenCalledTimes(1);
		expect(tauriFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8080/v1/models');
		expect(origFetch).not.toHaveBeenCalled();
	});

	it('normalizes a leading "./" before matching the chimera prefix', async () => {
		const { fetch, tauriFetch } = await setup();
		await fetch('./props');
		expect(tauriFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8080/props');
	});

	it('preserves the query string when rewriting', async () => {
		const { fetch, tauriFetch } = await setup();
		await fetch('/v1/models?verbose=1');
		expect(tauriFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8080/v1/models?verbose=1');
	});

	it('passes non-chimera paths through to the original browser fetch unchanged', async () => {
		const { fetch, tauriFetch, origFetch } = await setup();
		await fetch('/assets/logo.svg');
		expect(origFetch).toHaveBeenCalledTimes(1);
		expect(origFetch.mock.calls[0][0]).toBe('/assets/logo.svg');
		expect(tauriFetch).not.toHaveBeenCalled();
	});

	it('rewrites an absolute URL that targets our own origin', async () => {
		const { fetch, tauriFetch } = await setup();
		await fetch(`${SELF_ORIGIN}/v1/rerank`);
		expect(tauriFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8080/v1/rerank');
	});

	it('passes absolute URLs for external origins straight through', async () => {
		const { fetch, tauriFetch, origFetch } = await setup();
		await fetch('https://example.com/v1/models');
		expect(origFetch).toHaveBeenCalledTimes(1);
		expect(tauriFetch).not.toHaveBeenCalled();
	});
});

describe('chimera fetch wrapper — port resolution', () => {
	it('exposes the resolved base URL', async () => {
		const { mod } = await setup({ port: 9090 });
		expect(mod.getChimeraBaseUrl()).toBe('http://127.0.0.1:9090');
	});

	it('leaves the base null and does not rewrite when the port is unavailable', async () => {
		const { mod, fetch, tauriFetch, origFetch } = await setup({ port: null });
		expect(mod.getChimeraBaseUrl()).toBeNull();
		await fetch('/v1/models');
		expect(tauriFetch).not.toHaveBeenCalled();
		expect(origFetch).toHaveBeenCalledTimes(1);
	});
});

describe('chimera fetch wrapper — X-Chimera-Chat-Id', () => {
	it('injects the stored chimera chat id for a known conversation', async () => {
		const ls = fakeLocalStorage();
		ls.setItem(CHAT_ID_KEY, JSON.stringify({ conv1: 'chat-123' }));
		// Re-run setup but with the pre-seeded localStorage.
		vi.resetModules();
		const invoke = vi.fn(async () => 8080);
		const tauriFetch = vi.fn((_url: string, _init?: RequestInit) => new Response('ok'));
		vi.doMock('@tauri-apps/api/core', () => ({ invoke }));
		vi.doMock('@tauri-apps/plugin-http', () => ({ fetch: tauriFetch }));
		vi.stubGlobal('fetch', vi.fn(async () => new Response('orig')));
		vi.stubGlobal('window', { location: { origin: SELF_ORIGIN }, localStorage: ls });
		vi.stubGlobal('localStorage', ls);
		const mod = await import('./sidecar');
		mod.installChimeraFetch();
		await mod.resolveChimeraSidecar();

		await globalThis.fetch('/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify({ conversation_id: 'conv1' })
		});

		const headers = tauriFetch.mock.calls[0][1]?.headers as Headers;
		expect(headers.get('X-Chimera-Chat-Id')).toBe('chat-123');
	});

	it('persists the chimera chat id returned by the server for a new conversation', async () => {
		const { fetch, localStorage } = await setup({
			tauriFetch: () => new Response('ok', { headers: { 'X-Chimera-Chat-Id': 'srv-77' } })
		});

		await fetch('/v1/chat/completions', {
			method: 'POST',
			body: JSON.stringify({ conversation_id: 'conv-new' })
		});

		const saved = JSON.parse(localStorage.getItem(CHAT_ID_KEY) ?? '{}');
		expect(saved['conv-new']).toBe('srv-77');
	});

	it('does not add the header for non-chat POSTs', async () => {
		const { fetch, tauriFetch } = await setup();
		await fetch('/v1/rerank', { method: 'POST', body: JSON.stringify({ query: 'q' }) });
		const headers = tauriFetch.mock.calls[0][1]?.headers as Headers | undefined;
		expect(headers?.get?.('X-Chimera-Chat-Id') ?? null).toBeNull();
	});
});
