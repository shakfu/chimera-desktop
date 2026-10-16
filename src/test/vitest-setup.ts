// Setup for the "svelte" vitest project (jsdom environment).
//
// - Registers @testing-library/jest-dom's matchers on vitest's expect.
// - Unmounts rendered components after each test so the jsdom document does
//   not leak DOM between cases (explicit because the project runs with
//   globals: false, so testing-library's automatic afterEach hook is not
//   registered for us).
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/svelte';

// jsdom has no matchMedia; upstream's deviceStore builds MediaQuery objects
// at import time, and the $lib/utils barrel reaches it. Never-matching stub.
if (!window.matchMedia) {
	window.matchMedia = (query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		}) as MediaQueryList;
}

afterEach(() => {
	cleanup();
});
