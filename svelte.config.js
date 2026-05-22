import { mdsvex } from 'mdsvex';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// chimera-desktop deltas from upstream tools/server/webui/svelte.config.js:
//   - adapter pages/assets: '../public' -> 'build' (matches tauri.conf.json frontendDist)
//   - version.name: 'llama-server-webui' -> 'chimera-desktop'
// Hash-router + relative paths + single-bundle stay as-is. They were upstream's
// accommodations for being baked into llama-server at arbitrary paths; they're
// also load-bearing for chimera-desktop because removing bundleStrategy:'single'
// causes SvelteKit's SSR loader to evaluate pdfjs-dist (and possibly other
// browser-only modules) in Node, triggering "DOMMatrix is not defined" and
// other ReferenceErrors. Fixing that would require either dynamic-importing
// every browser-only module upstream uses, or excluding them via vite's
// ssr.noExternal — both more invasive than keeping single-bundle.

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [vitePreprocess(), mdsvex()],

	kit: {
		paths: {
			relative: true
		},
		router: { type: 'hash' },
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true
		}),
		output: {
			bundleStrategy: 'single'
		},
		alias: {
			$styles: 'src/styles'
		},
		version: {
			name: 'chimera-desktop'
		}
	},

	extensions: ['.svelte', '.svx']
};

export default config;
