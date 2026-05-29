import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';

// Mock the rerank client so the component test never touches the network /
// Tauri bridge — we only care about how the panel renders and wires events.
// vi.hoisted defines the mock fn before the hoisted vi.mock factory runs.
const { rerankMock } = vi.hoisted(() => ({ rerankMock: vi.fn() }));
vi.mock('$lib/chimera/rerank', () => ({ rerank: rerankMock }));

import RerankPanel from './RerankPanel.svelte';

afterEach(() => {
	vi.clearAllMocks();
});

describe('RerankPanel', () => {
	it('shows a spinner copy while availability is still being probed', () => {
		const { queryByText } = render(RerankPanel, { props: { enabled: null } });
		expect(queryByText(/Checking availability/)).not.toBeNull();
		expect(queryByText(/Rerank route not enabled/)).toBeNull();
	});

	it('shows the disabled guidance when the route is not enabled', () => {
		const { queryByText } = render(RerankPanel, { props: { enabled: false } });
		expect(queryByText(/Rerank route not enabled/)).not.toBeNull();
		expect(queryByText(/CHIMERA_DESKTOP_RERANK_MODEL/)).not.toBeNull();
		// The interactive form must not render in the disabled state.
		expect(queryByText('Documents')).toBeNull();
	});

	it('renders the query/documents form when enabled', () => {
		const { getByText, getByRole, queryByText } = render(RerankPanel, {
			props: { enabled: true }
		});
		expect(getByText('Query')).toBeTruthy();
		expect(getByText('Documents')).toBeTruthy();
		expect(getByRole('button', { name: /Rerank/ })).toBeTruthy();
		expect(queryByText(/Rerank route not enabled/)).toBeNull();
	});

	it('keeps Rerank disabled until a query and at least two documents are present', async () => {
		const { getByRole, getByPlaceholderText } = render(RerankPanel, {
			props: { enabled: true }
		});
		const button = getByRole('button', { name: /Rerank/ }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);

		await fireEvent.input(getByPlaceholderText('What are you ranking against?'), {
			target: { value: 'capital of France' }
		});
		await fireEvent.input(getByPlaceholderText('Document 1'), {
			target: { value: 'Paris is the capital of France.' }
		});
		// Still only one document filled -> stays disabled.
		expect(button.disabled).toBe(true);

		await fireEvent.input(getByPlaceholderText('Document 2'), {
			target: { value: 'Berlin is the capital of Germany.' }
		});
		expect(button.disabled).toBe(false);
	});

	it('calls rerank() with the filled query + documents and renders ranked results', async () => {
		rerankMock.mockResolvedValueOnce([
			{ index: 1, document: 'Paris is the capital of France.', score: 7.26, rank: 1 },
			{ index: 0, document: 'Bananas are yellow.', score: -9.1, rank: 2 }
		]);

		const { getByRole, getByPlaceholderText, findByText, queryByText } = render(RerankPanel, {
			props: { enabled: true }
		});

		await fireEvent.input(getByPlaceholderText('What are you ranking against?'), {
			target: { value: 'capital of France' }
		});
		await fireEvent.input(getByPlaceholderText('Document 1'), {
			target: { value: 'Bananas are yellow.' }
		});
		await fireEvent.input(getByPlaceholderText('Document 2'), {
			target: { value: 'Paris is the capital of France.' }
		});

		await fireEvent.click(getByRole('button', { name: /Rerank/ }));

		await waitFor(() => expect(rerankMock).toHaveBeenCalledTimes(1));
		expect(rerankMock).toHaveBeenCalledWith('capital of France', [
			'Bananas are yellow.',
			'Paris is the capital of France.'
		]);

		// The top-ranked document and its reorder badge should render.
		expect(await findByText('Paris is the capital of France.')).toBeTruthy();
		expect(queryByText('#1')).not.toBeNull();
	});

	it('renders the server error when rerank() rejects', async () => {
		rerankMock.mockRejectedValueOnce(new Error('HTTP 503: reranker not loaded'));

		const { getByRole, getByPlaceholderText, findByText } = render(RerankPanel, {
			props: { enabled: true }
		});
		await fireEvent.input(getByPlaceholderText('What are you ranking against?'), {
			target: { value: 'q' }
		});
		await fireEvent.input(getByPlaceholderText('Document 1'), { target: { value: 'a' } });
		await fireEvent.input(getByPlaceholderText('Document 2'), { target: { value: 'b' } });
		await fireEvent.click(getByRole('button', { name: /Rerank/ }));

		expect(await findByText(/HTTP 503: reranker not loaded/)).toBeTruthy();
	});
});
