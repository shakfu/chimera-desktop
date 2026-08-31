import { describe, expect, it } from 'vitest';
import { ModelsService } from '$lib/services/models.service';

// chimera reports the model id as the absolute path it loaded from, where
// upstream's parser assumes a Hugging Face `org/model` id. These pin the
// chimera-desktop patch in models.service.ts: a path collapses to its
// filename before parsing, and the HF ids upstream expects still parse the
// way upstream intends.
//
// A `.spec.ts` rather than a `.test.ts` despite being pure logic: importing
// models.service.ts pulls in the settings store and so `mode-watcher`, which
// only resolves under the browser conditions the "svelte" project sets. The
// "unit" project's plain-node resolution fails on it at import time.
describe('parseModelId with the path-shaped ids chimera reports', () => {
	it('parses an absolute POSIX path as if only the filename were given', () => {
		const fromPath = ModelsService.parseModelId(
			'/Users/me/projects/models/Llama-3.2-1B-Instruct-Q8_0.gguf'
		);
		expect(fromPath.orgName).toBeNull();
		expect(fromPath.modelName).toBe('Llama-3.2');
		expect(fromPath.params).toBe('1B');
		expect(fromPath.quantization).toBe('Q8_0');
		expect(fromPath.tags).toEqual(['Instruct']);
		// The directories must not leak into any rendered field.
		expect(fromPath.modelName).not.toContain('/');
		expect(fromPath.orgName ?? '').not.toContain('Users');

		// Identical to passing the bare filename.
		expect(fromPath).toEqual({
			...ModelsService.parseModelId('Llama-3.2-1B-Instruct-Q8_0.gguf'),
			raw: '/Users/me/projects/models/Llama-3.2-1B-Instruct-Q8_0.gguf'
		});
	});

	// raw backs the `showRawModelNames` setting, so the full path must survive
	// even though nothing else displays it.
	it('keeps the untouched id in raw', () => {
		const path = '/Users/me/models/Llama-3.2-1B-Instruct-Q8_0.gguf';
		expect(ModelsService.parseModelId(path).raw).toBe(path);
	});

	// The normalize step runs before the colon split precisely so a drive
	// letter is not read as a `model:quantization` separator.
	it('does not mistake a Windows drive letter for a quantization separator', () => {
		const parsed = ModelsService.parseModelId('C:\\Users\\me\\models\\Qwen3-4B-Q8_0.gguf');
		expect(parsed.modelName).toBe('Qwen3');
		expect(parsed.params).toBe('4B');
		expect(parsed.quantization).toBe('Q8_0');
	});

	// Without the extension strip the trailing segment reads as `Q8_0.gguf`,
	// which fails the quantization pattern and is rendered as a tag badge.
	it('reads the quantization off a .gguf filename instead of tagging it', () => {
		const parsed = ModelsService.parseModelId('/Users/me/models/Qwen3-4B-Q8_0.gguf');
		expect(parsed.quantization).toBe('Q8_0');
		expect(parsed.tags).not.toContain('Q8_0.gguf');
		expect(JSON.stringify(parsed).replace(parsed.raw, '')).not.toContain('.gguf');
	});

	it('leaves a Hugging Face org/model id parsing the upstream way', () => {
		const parsed = ModelsService.parseModelId('meta-llama/Llama-3.1-8B-Instruct');
		expect(parsed.orgName).toBe('meta-llama');
		expect(parsed.modelName).toBe('Llama-3.1');
		expect(parsed.params).toBe('8B');
	});

	it('still reads an explicit colon quantization off a path', () => {
		const parsed = ModelsService.parseModelId('/Users/me/models/Qwen3-4B:Q4_K_M');
		expect(parsed.quantization).toBe('Q4_K_M');
		expect(parsed.modelName).toBe('Qwen3');
	});
});
