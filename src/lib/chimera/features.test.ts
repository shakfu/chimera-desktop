import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the Tauri invoke bridge before importing the module under test.
// vi.hoisted runs before the hoisted vi.mock factory so `invoke` is defined
// when the factory references it.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { sidecarFeatures } from './features';

afterEach(() => {
	vi.clearAllMocks();
});

describe('sidecarFeatures', () => {
	it('returns the features reported by the sidecar_features command', async () => {
		invoke.mockResolvedValueOnce({
			audio: true,
			image: true,
			rag: true,
			rerank: true,
			lora: true,
			sdEagerLoad: true
		});
		expect(await sidecarFeatures()).toEqual({
			audio: true,
			image: true,
			rag: true,
			rerank: true,
			lora: true,
			sdEagerLoad: true
		});
		expect(invoke).toHaveBeenCalledWith('sidecar_features');
	});

	it('fills missing fields from the all-disabled default', async () => {
		// An older sidecar that does not report newer fields should still yield
		// a complete object with the rest defaulted to false.
		invoke.mockResolvedValueOnce({ audio: true });
		expect(await sidecarFeatures()).toEqual({
			audio: true,
			image: false,
			rag: false,
			rerank: false,
			lora: false,
			sdEagerLoad: false
		});
	});

	it('returns everything-disabled when the command throws (plain browser / no Tauri)', async () => {
		invoke.mockRejectedValueOnce(new Error('not in tauri'));
		expect(await sidecarFeatures()).toEqual({
			audio: false,
			image: false,
			rag: false,
			rerank: false,
			lora: false,
			sdEagerLoad: false
		});
	});

	// The Rust struct is `sd_eager_load`; it reaches us camelCased via serde's
	// rename_all. If that rename is ever dropped, the snake_case key lands as
	// an extra property and `sdEagerLoad` silently stays false — the merge
	// never throws — so assert the camelCase name is what actually carries.
	it('reads sdEagerLoad from the camelCase key, not a snake_case one', async () => {
		invoke.mockResolvedValueOnce({ image: true, sd_eager_load: true });
		const features = await sidecarFeatures();
		expect(features.sdEagerLoad).toBe(false);

		invoke.mockResolvedValueOnce({ image: true, sdEagerLoad: true });
		expect((await sidecarFeatures()).sdEagerLoad).toBe(true);
	});
});
