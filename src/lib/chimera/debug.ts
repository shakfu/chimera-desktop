// Runtime-gated debug logging mirror of src-tauri/src/debug.rs.
// Enable by setting localStorage.setItem('chimera.debug', '1') in
// devtools console (or set CHIMERA_DESKTOP_DEBUG=1 in the environment
// before launching — Rust will print a one-line ack and the JS will
// pick that up via a Tauri command if we ever wire it through).
//
// When off, calls to chdbg() are still-cheap no-ops (one localStorage
// read once at module init, then a boolean check per call).

const enabled = (() => {
	if (typeof window === 'undefined') return false;
	try {
		return window.localStorage.getItem('chimera.debug') === '1';
	} catch {
		return false;
	}
})();

export function chdbg(...args: unknown[]): void {
	if (!enabled) return;
	console.warn('[chimera]', ...args);
}

export function chdbgEnabled(): boolean {
	return enabled;
}
