import { describe, expect, it, vi } from 'vitest';
import { ChatService } from '$lib/services/chat.service';

// Covers the chimera-desktop patch in ChatService.handleStreamResponse: an
// in-stream `data: {"error": ...}` event must surface the server's message
// and must not trigger the resume path.

function sse(...events: string[]): Response {
	return new Response(events.map((e) => `data: ${e}\n\n`).join(''), {
		headers: { 'Content-Type': 'text/event-stream' }
	});
}

const delta = (content: string) =>
	JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] });

describe('handleStreamResponse in-stream errors', () => {
	it('reports the server message and does not resume', async () => {
		const resume = vi.spyOn(ChatService, 'resumeStream');
		const onError = vi.fn();
		const onComplete = vi.fn();
		const message = 'The model produced output that does not match the expected peg-native format';

		await expect(
			ChatService.handleStreamResponse(
				sse(delta('Hi'), JSON.stringify({ error: { code: 500, message, type: 'server_error' } })),
				undefined,
				onComplete,
				onError,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				'conv-err'
			)
		).rejects.toThrow(message);

		expect(onError).toHaveBeenCalledOnce();
		expect(onError.mock.calls[0][0].message).toBe(message);
		expect(onComplete).not.toHaveBeenCalled();
		expect(resume).not.toHaveBeenCalled();
		resume.mockRestore();
	});

	it('still completes a normal stream', async () => {
		const onComplete = vi.fn();
		const onError = vi.fn();

		await ChatService.handleStreamResponse(
			sse(delta('Hi'), delta(' there'), '[DONE]'),
			undefined,
			onComplete,
			onError
		);

		expect(onError).not.toHaveBeenCalled();
		expect(onComplete).toHaveBeenCalledOnce();
		expect(onComplete.mock.calls[0][0]).toBe('Hi there');
	});
});
