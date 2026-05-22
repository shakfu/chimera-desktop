// chimera-desktop runtime glue between the Tauri shell and the vendored
// llama-ui frontend.
//
// Upstream llama-ui assumes it is served by `llama-server` at the same origin
// and uses relative paths like `./v1/chat/completions`, `./props`, etc. In
// the Tauri webview the origin is `tauri://localhost/` (production) or
// `http://localhost:1420/` (dev), neither of which routes to chimera. On top
// of that, chimera does not send `Access-Control-Allow-Origin` headers (no
// `--cors` flag), and upstream's vite config keeps COEP `require-corp` set,
// so the webview's `fetch` is doubly blocked from talking to a different
// origin. This module:
//
//   1. Rebinds `globalThis.fetch` synchronously to a wrapper that rewrites
//      relative API URLs (`./` or `/` prefixed paths matching the chimera
//      surface) to absolute URLs against the sidecar's
//      `http://127.0.0.1:<port>`. The wrapper is in place before any
//      component imports run their first fetch.
//   2. Asynchronously resolves the chimera sidecar port via the Rust
//      `sidecar_port` Tauri command; any fetch issued before that resolves
//      awaits a one-shot promise.
//   3. Routes the rewritten requests through `@tauri-apps/plugin-http`'s
//      fetch (Rust's reqwest under the hood) instead of the browser fetch,
//      bypassing the webview's CORS / COEP enforcement. Non-chimera URLs
//      stay on the original browser fetch so things like Vite HMR and
//      data: URLs are unaffected.
//   4. Augments `/v1/chat/completions` POSTs with the `X-Chimera-Chat-Id`
//      header, persisting the id returned in the response back into
//      localStorage keyed by upstream's conversation id. Closes the
//      persistence-consolidation gap called out in chimera/docs/dev/webui.md
//      §5.6.
//
// All other patches to vendored files live in their original locations with
// a `chimera-desktop:` comment marker for grep-driven rebases.

import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

console.warn('[chimera] sidecar.ts module loaded');

let chimeraBase: string | null = null;
let installed = false;
let resolveBase: () => void;
const baseReady: Promise<void> = new Promise((res) => {
	resolveBase = res;
});

// Path prefixes that upstream's services hit and that must be redirected to
// the chimera sidecar. Sourced from a grep of `fetch(` in src/lib/services/
// plus the dev-proxy entries in upstream vite.config.ts.
const CHIMERA_PATH_PREFIXES = [
	'/v1',
	'/props',
	'/models',
	'/tools',
	'/slots',
	'/cors-proxy',
	'/lora-adapters',
	'/health',
	'/infill',
	'/tokenize',
	'/detokenize',
	'/apply-template',
	'/metrics',
	'/rerank'
];

function isChimeraApiPath(path: string): boolean {
	return CHIMERA_PATH_PREFIXES.some(
		(prefix) =>
			path === prefix ||
			path.startsWith(prefix + '/') ||
			path.startsWith(prefix + '?')
	);
}

function isAbsolute(url: string): boolean {
	// Match any scheme://, not just http(s). Critical: this includes
	// `ipc://` and `tauri://` so Tauri 2's IPC custom-protocol fetches
	// pass straight through to the native fetch without our path-based
	// rewriting logic touching them.
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}

function getSelfOrigin(): string {
	return typeof window !== 'undefined' ? window.location.origin : '';
}

function maybeRewrite(url: string): string {
	if (!chimeraBase) return url;

	let path: string;
	if (isAbsolute(url)) {
		// Absolute URL. Only rewrite if it targets our own origin
		// (webview dev at http://localhost:1420 or production at
		// tauri://localhost). External origins and Tauri's own ipc://
		// scheme pass through. Upstream often passes Request objects
		// or absolute URLs to fetch, which is why we have to handle
		// this case rather than just rewriting relative URLs.
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return url;
		}
		if (parsed.origin !== getSelfOrigin()) return url;
		path = parsed.pathname + parsed.search;
	} else {
		path = url.replace(/^\.?\/+/, '/');
	}

	if (!isChimeraApiPath(path)) return url;
	return chimeraBase + path;
}

// X-Chimera-Chat-Id persistence: upstream's conversation id (from the
// request body) -> chimera's chats row id (echoed back in the response
// header). Persisted in localStorage so the mapping survives reloads.
const CHAT_ID_STORAGE_KEY = 'chimera.chatIds.v1';

function loadChatIdMap(): Record<string, string> {
	try {
		const raw = localStorage.getItem(CHAT_ID_STORAGE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function saveChatIdMap(map: Record<string, string>): void {
	try {
		localStorage.setItem(CHAT_ID_STORAGE_KEY, JSON.stringify(map));
	} catch {
		/* ignore quota / serialization errors */
	}
}

function extractConversationId(body: unknown): string | null {
	if (typeof body !== 'string') return null;
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		return (
			(parsed.conversation_id as string | undefined) ??
			(parsed.chat_id as string | undefined) ??
			null
		);
	} catch {
		return null;
	}
}

function isChatCompletionsRequest(url: string, method: string | undefined): boolean {
	if ((method ?? 'GET').toUpperCase() !== 'POST') return false;
	return url.includes('/v1/chat/completions');
}

let __originalFetch: typeof fetch = globalThis.fetch.bind(globalThis);

// Conditional version of maybeRewrite that only checks the predicate
// "would this URL be rewritten if chimeraBase were set?" without actually
// doing the rewrite. Used to decide whether chimeraFetch should await
// baseReady. We can't unconditionally await it: Tauri 2's IPC custom
// protocol on macOS uses fetch to `ipc://localhost/...` to deliver
// invoke messages, and blocking those would deadlock IPC (invoke needs
// fetch to reach Rust, fetch waits on invoke result via baseReady).
// By only awaiting for URLs we'd actually rewrite, ipc:// fetches pass
// through immediately and IPC resolves; chimera-bound fetches queue
// until the sidecar port is known and then succeed.
function wouldRewrite(url: string): boolean {
	let path: string;
	if (isAbsolute(url)) {
		try {
			const parsed = new URL(url);
			if (parsed.origin !== getSelfOrigin()) return false;
			path = parsed.pathname + parsed.search;
		} catch {
			return false;
		}
	} else {
		path = url.replace(/^\.?\/+/, '/');
	}
	return isChimeraApiPath(path);
}

async function chimeraFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	let url: string;
	let originalRequest: Request | null = null;

	if (typeof input === 'string') {
		url = input;
	} else if (input instanceof URL) {
		url = input.toString();
	} else {
		originalRequest = input;
		url = input.url;
	}

	// Wait for the sidecar port if (and only if) this URL would be
	// rewritten to chimera. Eliminates the "Server unavailable" sticky
	// error from upstream's first /props fetch firing before
	// resolveChimeraSidecar completes. See wouldRewrite() comment for
	// why this is conditional.
	if (!chimeraBase && wouldRewrite(url)) {
		await baseReady;
	}

	const rewritten = maybeRewrite(url);
	const isChat = isChatCompletionsRequest(
		rewritten,
		init?.method ?? originalRequest?.method
	);

	let finalInit: RequestInit | undefined = init;
	let convId: string | null = null;

	if (isChat) {
		convId = extractConversationId(init?.body ?? null);
		if (convId) {
			const map = loadChatIdMap();
			const chimeraId = map[convId];
			const headers = new Headers(init?.headers ?? originalRequest?.headers);
			if (chimeraId) headers.set('X-Chimera-Chat-Id', chimeraId);
			finalInit = { ...(init ?? {}), headers };
		}
	}

	// Non-chimera URLs: pass through to the browser fetch (HMR, data URLs,
	// blob URLs, anything not in CHIMERA_PATH_PREFIXES). Chimera URLs: go
	// through the Tauri http plugin so we bypass the webview's CORS / COEP
	// enforcement.
	const usedRewrite = rewritten !== url;
	const response = usedRewrite
		? await tauriFetch(rewritten, finalInit)
		: originalRequest
			? await __originalFetch(originalRequest, finalInit)
			: await __originalFetch(url, finalInit);

	if (isChat && convId) {
		const chimeraId = response.headers.get('X-Chimera-Chat-Id');
		if (chimeraId) {
			const map = loadChatIdMap();
			if (map[convId] !== chimeraId) {
				map[convId] = chimeraId;
				saveChatIdMap(map);
			}
		}
	}

	return response;
}

export function installChimeraFetch(): void {
	console.warn('[chimera] installChimeraFetch entered, already-installed=', installed);
	if (installed) return;
	installed = true;
	__originalFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = chimeraFetch as typeof fetch;
	console.warn('[chimera] installChimeraFetch done, fetch wrapped');
}

let resolveStarted = false;

export async function resolveChimeraSidecar(): Promise<void> {
	if (resolveStarted) return;
	resolveStarted = true;
	console.warn('[chimera] resolveChimeraSidecar entered');
	try {
		console.warn('[chimera] about to invoke sidecar_port');
		const port = await invoke<number | null>('sidecar_port');
		console.warn('[chimera] sidecar_port returned', port);
		if (port != null) {
			chimeraBase = `http://127.0.0.1:${port}`;
			console.warn(`[chimera] api base = ${chimeraBase}`);
		} else {
			console.warn('[chimera] sidecar_port returned null; chimera-bound fetches will fail');
		}
	} catch (e) {
		console.error('[chimera] failed to resolve sidecar port', e);
	} finally {
		console.warn('[chimera] resolveBase() about to fire');
		resolveBase();
	}
}

export async function initChimeraRuntime(): Promise<void> {
	installChimeraFetch();
	await resolveChimeraSidecar();
}

export function getChimeraBaseUrl(): string | null {
	return chimeraBase;
}
