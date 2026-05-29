import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { resolve } from 'path';

import { defineConfig } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';

// chimera-desktop deltas from upstream tools/server/webui/vite.config.ts:
//   - server.port: pinned to 1420 + strictPort: true (Tauri expectation)
//   - server.proxy: removed (chimera-desktop talks to the sidecar at a
//     dynamic 127.0.0.1:<port> resolved at app start, not a fixed
//     localhost:8080; see src/lib/chimera/sidecar.ts)
//   - dropped: llamaCppBuildPlugin (upstream's static-build favicon-inline
//     post-processor; not relevant for a Tauri bundle)
//   - dropped: vitest test.* config (tests are not vendored)
//   - dropped: scss preprocessorOptions woff toggles (unused by our build)
//   - kept: COEP/COOP headers (Pyodide), Tailwind, sveltekit, devtoolsJson

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	resolve: {
		alias: {
			'katex-fonts': resolve('node_modules/katex/dist/fonts')
		}
	},

	build: {
		assetsInlineLimit: 32000,
		chunkSizeWarningLimit: 3072,
		minify: true
	},

	esbuild: {
		lineLimit: 500,
		minifyIdentifiers: false
	},

	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],

	clearScreen: false,

	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: 'ws',
					host,
					port: 1421
				}
			: undefined,
		// chimera-desktop: COEP/COOP headers removed. Upstream sets them for
		// Pyodide (Python-in-browser) support; we're not using Pyodide. They
		// can interfere with Tauri's IPC bridge initialization on some
		// macOS WKWebView configurations. Re-enable if Pyodide is wired up.
		watch: {
			ignored: ['**/src-tauri/**']
		}
	}
});
