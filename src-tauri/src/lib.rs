mod sidecar;

use sidecar::SidecarState;
use tauri::Manager;

// Minimal IPC sanity command — takes no state, returns an owned String.
// Async to match Tauri 2's preferred command shape. If this hangs from JS
// while the terminal shows "[chimera-desktop] ping invoked", IPC outgoing
// works but incoming is broken. If the terminal shows nothing, the JS
// invoke is not reaching Rust at all (likely capability gating).
#[tauri::command]
async fn ping() -> String {
    eprintln!("[chimera-desktop] ping invoked");
    "pong".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarState::default())
        .setup(|app| {
            let labels: Vec<String> = app.webview_windows().keys().cloned().collect();
            eprintln!("[chimera-desktop] webview window labels: {labels:?}");

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
