// Runtime-gated debug logging. Enable with CHIMERA_DESKTOP_DEBUG=1 in
// the environment that starts the Tauri app. When off, `debug!(...)`
// expands to a cheap boolean check that is generally branch-predicted
// away in release builds and is a no-op in dev builds. When on, the
// formatted line is written to stderr prefixed with [chimera-desktop].
//
// Critical eprintlns (sidecar spawn failure, terminated, healthy)
// remain unconditional so a fresh `make run` still surfaces the
// minimum information needed to diagnose a launch failure.

use std::sync::OnceLock;

static DEBUG_ENABLED: OnceLock<bool> = OnceLock::new();

pub fn init() {
    let enabled = std::env::var("CHIMERA_DESKTOP_DEBUG").is_ok();
    let _ = DEBUG_ENABLED.set(enabled);
    if enabled {
        eprintln!("[chimera-desktop] CHIMERA_DESKTOP_DEBUG=1 — verbose logging on");
    }
}

pub fn enabled() -> bool {
    *DEBUG_ENABLED.get().unwrap_or(&false)
}

#[macro_export]
macro_rules! debug {
    ($($arg:tt)*) => {
        if $crate::debug::enabled() {
            eprintln!("[chimera-desktop] {}", format_args!($($arg)*));
        }
    };
}
