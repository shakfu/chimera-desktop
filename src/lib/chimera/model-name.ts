// Display name for the path-shaped model ids chimera reports.
//
// chimera identifies the loaded model by the absolute path it was loaded from
// (`/Users/me/models/Llama-3.2-1B-Instruct-Q8_0.gguf`), because that is what
// `-m` was given. Upstream's UI assumes a Hugging Face `org/model` id and
// renders the id more or less verbatim, so without this the whole path shows
// up in the chat form's model chip and in the status bar.
//
// Two consumers, which is why this is not inlined at either:
//   - the chimera-desktop patch in `models.service.ts`, which feeds the
//     result to upstream's `parseModelId` so every model chip, badge and
//     dropdown across the vendored UI gets the short name.
//   - `components/StatusBar.svelte`, which shows a single compact string.

import { normalizeModelName } from '$lib/utils';

// Upstream's normalizeModelName handles the directories (multiple path
// separators -> filename; a single one -> preserved as `org/model`, so real
// HF ids are untouched). The extension is ours to remove: `.gguf` is a
// container format, not part of the model's name, and leaving it attached
// also breaks upstream's quantization detection, which reads the last
// dash-separated segment -- `Q8_0.gguf` fails the pattern where `Q8_0`
// matches. Only this one extension is stripped, so a model whose real final
// segment happens to resemble a file suffix survives intact.
export function modelDisplayName(modelId: string): string {
	return normalizeModelName(modelId).replace(/\.gguf$/i, '');
}
