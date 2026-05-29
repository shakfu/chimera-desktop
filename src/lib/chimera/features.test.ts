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
		invoke.mockResolvedValueOnce({ audio: true, image: false, rag: true, rerank: true });
		expect(await sidecarFeatures()).toEqual({
			audio: true,
			image: false,
			rag: true,
			rerank: true
		});
		expect(invoke).toHaveBeenCalledWith('sidecar_features');
	});

	it('fills missing fields from the all-disabled default', async () => {
		// An older sidecar that does not report `rerank` should still yield a
		// complete object with rerank defaulted to false.
		invoke.mockResolvedValueOnce({ audio: true });
		expect(await sidecarFeatures()).toEqual({
			audio: true,
			image: false,
			rag: false,
			rerank: false
		});
	});

	it('returns everything-disabled when the command throws (plain browser / no Tauri)', async () => {
		invoke.mockRejectedValueOnce(new Error('not in tauri'));
		expect(await sidecarFeatures()).toEqual({
			audio: false,
			image: false,
			rag: false,
			rerank: false
		});
	});
});
