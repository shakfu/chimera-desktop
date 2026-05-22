mod debug;
mod sidecar;

use sidecar::SidecarState;
use tauri::{Manager, RunEvent};

// Minimal IPC sanity command — takes no state, returns an owned String.
// Async to match Tauri 2's preferred command shape. Useful sanity check
// when IPC misbehaves (see docs/implementation.md).
#[tauri::command]
async fn ping() -> String {
    debug!("ping invoked");
    "pong".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    debug::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarState::default())
        .setup(|app| {
            let labels: Vec<String> = app.webview_windows().keys().cloned().collect();
            debug!("webview window labels: {labels:?}");

            let handle = app.handle().clone();
            if let Err(e) = sidecar::spawn(&handle) {
                eprintln!("[chimera-desktop] sidecar spawn failed: {e}");
                let state = handle.state::<SidecarState>();
                *state.status.lock().unwrap() = sidecar::SidecarStatus::Failed(e);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                sidecar::kill(&window.app_handle().clone());
            }
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            sidecar::sidecar_port,
            sidecar::sidecar_status,
            sidecar::sidecar_mark_ready,
        ])
        // build().run(...) lets us hook RunEvent::Exit to kill the
        // sidecar child as a last-resort cleanup path. on_window_event
        // covers the common case (close the window); RunEvent::Exit
        // covers Ctrl-C / Cmd-Q / RunEvent::ExitRequested-accept paths.
        // Combined with the ChildGuard Drop impl on SidecarState, this
        // gives us three layers — at least one usually fires before the
        // process truly dies. Hard SIGKILLs still leak the child; only
        // the OS can reap those.
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, RunEvent::Exit) {
                debug!("RunEvent::Exit — killing sidecar");
                sidecar::kill(app_handle);
            }
        });
}
