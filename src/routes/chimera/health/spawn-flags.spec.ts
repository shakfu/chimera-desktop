import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

// The diagnostics page reads the sidecar's spawn-time flags through the Tauri
// bridge. Mock both the raw `invoke` (port / status) and the features client
// so the test never touches Tauri or the network.
//
// `sidecar_status` resolves to Failed on purpose: the page's onMount polls
// /health up to 300 times on a 500ms interval, and a terminal status is the
// one branch that stops the loop after the first pass. The flags section
// renders from the same refreshStatus() call, so it is populated either way.
const { invoke, sidecarFeatures } = vi.hoisted(() => ({
	invoke: vi.fn(),
	sidecarFeatures: vi.fn()
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('$lib/chimera/features', () => ({ sidecarFeatures }));

import HealthPage from './+page.svelte';

const ALL_OFF = {
	audio: false,
	image: false,
	rag: false,
	rerank: false,
	lora: false,
	sdEagerLoad: false
};

function mountWith(features: Partial<typeof ALL_OFF>) {
	invoke.mockImplementation((cmd: string) =>
		cmd === 'sidecar_port' ? Promise.resolve(51234) : Promise.resolve({ kind: 'Failed', detail: 'x' })
	);
	sidecarFeatures.mockResolvedValue({ ...ALL_OFF, ...features });
	return render(HealthPage);
}

// The flag row is `<dt>SD eager load</dt><dd>on|off …</dd>`; read the sibling
// <dd> so an "on" elsewhere on the page (another route) cannot satisfy it.
function eagerRow(container: HTMLElement): HTMLElement {
	const dt = [...container.querySelectorAll('dt')].find((el) => el.textContent === 'SD eager load');
	if (!dt) throw new Error('SD eager load row not rendered');
	return dt.nextElementSibling as HTMLElement;
}

afterEach(() => {
	vi.clearAllMocks();
});

describe('diagnostics spawn flags', () => {
	it('reports every optional route with its serve flag', async () => {
		const { container, findByText } = mountWith({ audio: true, rag: true });
		await findByText('Spawn flags');
		for (const flag of [
			'--enable-audio',
			'--enable-image',
			'--enable-rag',
			'--reranking',
			'--lora',
			'--sd-eager-load'
		]) {
			expect(container.textContent).toContain(flag);
		}
	});

	it('shows eager load as on, with the no-warmup explanation', async () => {
		const { container } = mountWith({ image: true, sdEagerLoad: true });
		await waitFor(() => expect(eagerRow(container).textContent).toContain('on'));
		expect(eagerRow(container).textContent).toMatch(/skips the warmup/);
	});

	// The actionable case: the image panel works but its first generation is
	// slow, and the page should say how to change that.
	it('tells you how to enable it when image is on but eager load is off', async () => {
		const { container } = mountWith({ image: true, sdEagerLoad: false });
		await waitFor(() => expect(eagerRow(container).textContent).toContain('off'));
		expect(eagerRow(container).textContent).toMatch(/pays a warmup/);
		expect(eagerRow(container).textContent).toContain('SD_EAGER_LOAD=1');
	});

	// With no image route the flag is never passed, so advertising the make
	// variable here would send you after a knob that changes nothing.
	it('marks eager load not applicable when the image route is off', async () => {
		const { container } = mountWith({ image: false, sdEagerLoad: false });
		await waitFor(() => expect(eagerRow(container).textContent).toMatch(/not applicable/));
		expect(eagerRow(container).textContent).not.toContain('SD_EAGER_LOAD=1');
	});
});
