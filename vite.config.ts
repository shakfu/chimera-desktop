import { buildInfoPlugin } from './scripts/vite-plugin-build-info';
import { nerdamerPlugin } from './scripts/vite-plugin-nerdamer';
import { relativizeBasePlugin } from './scripts/vite-plugin-relativize-base';
import { splashScreenPlugin } from './scripts/vite-plugin-splash-screen';
import { SVELTEKIT_PWA_OPTIONS } from './src/lib/constants/pwa.constants';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { resolve } from 'path';
import { defineConfig } from 'vite';

// chimera-desktop deltas from upstream tools/ui/vite.config.ts:
//   - SvelteKitPWA: `disable: true` plus `devOptions.enabled: false` (upstream
//     enables the dev SW, and `disable` alone does not stop it). The plugin
//     still provides the virtual:pwa-* modules upstream imports, but no
//     service worker is emitted or registered; a Tauri webview has no use
//     for one and it would cache stale bundles.
//   - server: port 1420 + strictPort (Tauri), TAURI_DEV_HOST hmr,
//     src-tauri watch exclusion, clearScreen: false.
//   - removed: server.proxy (sidecar.ts routes chimera paths; its
//     CHIMERA_PATH_PREFIXES mirrors upstream's proxy list), COEP/COOP
//     headers (can break Tauri IPC init on WKWebView), test.* projects
//     (storybook/playwright; we run our own vitest.config.ts).

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	build: {
		assetsInlineLimit: 32000,
		chunkSizeWarningLimit: 3072,
		minify: true
	},

	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({ ...SVELTEKIT_PWA_OPTIONS, devOptions: { enabled: false }, disable: true }),
		splashScreenPlugin(),
		buildInfoPlugin(),
		nerdamerPlugin(),
		relativizeBasePlugin()
	],

	resolve: {
		alias: {
			'katex-fonts': resolve('node_modules/katex/dist/fonts')
		}
	},

	clearScreen: false,

	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
		watch: {
			ignored: ['**/src-tauri/**']
		}
	}
});
