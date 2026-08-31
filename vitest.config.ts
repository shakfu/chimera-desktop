import { resolve } from 'path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// Two test projects, split by filename so each gets the lightest environment
// that can run it:
//
//   *.test.ts  -> "unit": plain Node, no Svelte plugin. Fast, isolated
//                 pure-logic tests (the chimera API clients, the fetch
//                 rewriter). I/O is mocked (fetch, Tauri invoke).
//   *.spec.ts  -> "svelte": jsdom + the Svelte compiler, for component tests
//                 (@testing-library/svelte). svelteTesting() flips Vite's
//                 resolve conditions to the browser/client build so mount()
//                 works (the SvelteKit plugin would force the SSR build, whose
//                 mount() throws). We use the bare svelte() plugin rather than
//                 sveltekit() because component tests here don't need the
//                 $app/* virtual modules; a plain `$lib` alias is enough.
const svelteAlias = { $lib: resolve('./src/lib') };

// The "svelte" project runs the bare svelte() plugin, so SvelteKit's $app/*
// virtual modules do not exist. Component tests never needed them, but a spec
// that imports a service reaches them transitively -- models.service.ts pulls
// the $lib/utils barrel, which reaches the settings store ($app/environment)
// and api-fetch ($app/paths). Stub those two; $app/navigation and $app/state
// are only imported by components no spec mounts, so they are left out until
// something needs them.
const svelteProjectAlias = {
	...svelteAlias,
	'$app/environment': resolve('./src/test/app-environment-stub.ts'),
	'$app/paths': resolve('./src/test/app-paths-stub.ts')
};

export default defineConfig({
	test: {
		projects: [
			{
				resolve: { alias: svelteAlias },
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts'],
					globals: false
				}
			},
			{
				plugins: [svelte(), svelteTesting({ autoCleanup: false })],
				resolve: { alias: svelteProjectAlias },
				test: {
					name: 'svelte',
					environment: 'jsdom',
					include: ['src/**/*.spec.ts'],
					setupFiles: ['./src/test/vitest-setup.ts'],
					globals: false
				}
			}
		]
	}
});
