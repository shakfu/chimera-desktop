// Stub for SvelteKit's `$app/state` in the "svelte" vitest project. See
// app-environment-stub.ts for why these stubs exist. `page` mirrors the
// root route with no params.
export const page = {
	params: {} as Record<string, string>,
	route: { id: null as string | null },
	url: new URL('http://localhost/')
};
