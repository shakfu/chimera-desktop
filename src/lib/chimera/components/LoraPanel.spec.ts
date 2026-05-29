import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

// Mock the lora client so the component test never touches the network /
// Tauri bridge. vi.hoisted defines the fns before the hoisted vi.mock factory.
const { listAdaptersMock, setScalesMock } = vi.hoisted(() => ({
	listAdaptersMock: vi.fn(),
	setScalesMock: vi.fn()
}));
vi.mock('$lib/chimera/lora', () => ({
	listAdapters: listAdaptersMock,
	setScales: setScalesMock
}));

import LoraPanel from './LoraPanel.svelte';

const ADAPTERS = [
	{ id: 0, path: '/models/style-lora.gguf', scale: 1 },
	{ id: 1, path: '/models/detail-lora.gguf', scale: 0.5 }
];

afterEach(() => {
	vi.clearAllMocks();
});

describe('LoraPanel', () => {
	it('shows probing copy while availability is unknown', () => {
		const { queryByText } = render(LoraPanel, { props: { enabled: null } });
		expect(queryByText(/Checking availability/)).not.toBeNull();
	});

	it('shows the not-loaded guidance when no adapters are present', () => {
		const { queryByText } = render(LoraPanel, { props: { enabled: false } });
		expect(queryByText(/No LoRA adapters loaded/)).not.toBeNull();
		expect(queryByText(/CHIMERA_DESKTOP_LORA/)).not.toBeNull();
	});

	it('lists the loaded adapters with their basenames when enabled', async () => {
		listAdaptersMock.mockResolvedValueOnce(ADAPTERS);
		const { findByText, queryByText } = render(LoraPanel, { props: { enabled: true } });
		expect(await findByText('style-lora.gguf')).toBeTruthy();
		expect(queryByText('detail-lora.gguf')).not.toBeNull();
	});

	it('keeps Apply disabled until a scale changes, then applies all scales', async () => {
		listAdaptersMock.mockResolvedValueOnce(ADAPTERS);
		setScalesMock.mockResolvedValueOnce([
			{ id: 0, path: '/models/style-lora.gguf', scale: 0.25 },
			{ id: 1, path: '/models/detail-lora.gguf', scale: 0.5 }
		]);

		const { findByText, getByRole, getByLabelText } = render(LoraPanel, {
			props: { enabled: true }
		});
		await findByText('style-lora.gguf');

		const apply = getByRole('button', { name: /Apply/ }) as HTMLButtonElement;
		expect(apply.disabled).toBe(true);

		await fireEvent.input(getByLabelText(/Scale for style-lora.gguf/), {
			target: { value: '0.25' }
		});
		expect(apply.disabled).toBe(false);

		await fireEvent.click(apply);
		await waitFor(() => expect(setScalesMock).toHaveBeenCalledTimes(1));
		expect(setScalesMock).toHaveBeenCalledWith([
			{ id: 0, scale: 0.25 },
			{ id: 1, scale: 0.5 }
		]);
		// After applying, the server-reconciled scales clear the dirty state.
		await waitFor(() => expect(apply.disabled).toBe(true));
	});

	it('renders the server error when applying fails', async () => {
		listAdaptersMock.mockResolvedValueOnce(ADAPTERS);
		setScalesMock.mockRejectedValueOnce(new Error('HTTP 500: apply failed'));

		const { findByText, getByRole, getByLabelText } = render(LoraPanel, {
			props: { enabled: true }
		});
		await findByText('style-lora.gguf');
		await fireEvent.input(getByLabelText(/Scale for style-lora.gguf/), {
			target: { value: '1.5' }
		});
		await fireEvent.click(getByRole('button', { name: /Apply/ }));

		expect(await findByText(/HTTP 500: apply failed/)).toBeTruthy();
	});
});
