// Stub for SvelteKit's `$app/environment` in the "svelte" vitest project.
//
// That project runs the bare svelte() plugin rather than sveltekit() (see
// vitest.config.ts), so the $app/* virtual modules do not exist. Component
// tests never needed them, but a spec that imports a store-touching module --
// models.service.ts reaches the settings store, which reads `browser` --
// fails at import time without this.
//
// `browser` is the only binding anything in src/ imports from this module.
// true, because the specs run in jsdom: code guarded on `browser` should take
// the same path it does in the app.
export const browser = true;
export const dev = true;
export const building = false;
export const version = 'test';
