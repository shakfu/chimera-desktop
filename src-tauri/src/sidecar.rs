// Sidecar lifecycle for the bundled chimera binary.
//
// Spawn order:
//   1. Pick a free localhost port (bind :0, read, drop).
//   2. Read the model path from env var CHIMERA_DESKTOP_MODEL.
//   3. Spawn `chimera serve --host 127.0.0.1 --port <port> -m <model>`
//      via the tauri-plugin-shell sidecar API.
//   4. Stream stdout/stderr to the host process log.
//   5. Park the child handle in SidecarState so app shutdown can kill it.
//
// Per docs/dev/chimera-desktop-plan.md § 4: the webview only ever talks
// to 127.0.0.1:<port>; the sidecar is never exposed beyond loopback.

use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
pub struct SidecarState {
    pub port: Mutex<Option<u16>>,
    pub child: Mutex<Option<CommandChild>>,
    pub status: Mutex<SidecarStatus>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum SidecarStatus {
    #[default]
    NotStarted,
    Starting,
    Running,
    Failed(String),
    Exited(i32),
}

fn pick_free_port() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

pub fn spawn(app: &AppHandle) -> Result<(), String> {
    let model_raw = std::env::var("CHIMERA_DESKTOP_MODEL").map_err(|_| {
        "CHIMERA_DESKTOP_MODEL is not set; export it to a .gguf path and restart".to_string()
    })?;

    // The bundled chimera child inherits Tauri's cwd, which is generally not
    // the user's shell cwd (and certainly not the chimera-desktop repo root
    // when launched via `make run` / `npm run tauri dev` / a Finder-launched
    // bundle). A relative model path would resolve against the wrong cwd and
    // chimera would exit code 3 with "failed to load model". Resolve against
    // *our* cwd up front, then verify the file exists so the error surface
    // is a Tauri-level `Failed(...)` with a useful message rather than a
    // silent post-spawn exit.
    let model_path = std::path::PathBuf::from(&model_raw);
    let model_absolute = if model_path.is_absolute() {
        model_path
    } else {
        let cwd = std::env::current_dir()
            .map_err(|e| format!("cannot read current dir to resolve model path: {e}"))?;
        cwd.join(&model_path)
    };
    let model_canonical = std::fs::canonicalize(&model_absolute).map_err(|e| {
        format!(
            "model file not readable at {}: {e}",
            model_absolute.display()
        )
    })?;
    let model = model_canonical.to_string_lossy().into_owned();
    eprintln!("[chimera-desktop] resolved model path: {model}");

    let port = pick_free_port().map_err(|e| format!("port pick failed: {e}"))?;

    let cmd = app
        .shell()
        .sidecar("chimera")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?
        .args([
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "-m",
            &model,
        ]);

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    let state = app.state::<SidecarState>();
    *state.port.lock().unwrap() = Some(port);
    *state.child.lock().unwrap() = Some(child);
    *state.status.lock().unwrap() = SidecarStatus::Starting;

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    println!("[chimera] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[chimera] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(payload) => {
                    let code = payload.code.unwrap_or(-1);
                    eprintln!("[chimera] terminated code={code}");
                    let state = app_for_task.state::<SidecarState>();
                    *state.status.lock().unwrap() = SidecarStatus::Exited(code);
                    break;
                }
                CommandEvent::Error(msg) => {
                    eprintln!("[chimera] error: {msg}");
                    let state = app_for_task.state::<SidecarState>();
                    *state.status.lock().unwrap() = SidecarStatus::Failed(msg);
                    break;
                }
                _ => {}
            }
        }
    });

    // Health-probe task: poll GET /health until it returns 200, then flip
    // Starting -> Running. Owned by the Rust side so the status truthfully
    // reflects sidecar readiness regardless of which (if any) frontend page
    // is currently mounted. Times out after 120s of probing — model load on
    // a cold start can take a while, but if we're still not ready after two
    // minutes, something is genuinely wrong and the status stays Starting
    // (visible-but-not-misleading) until the Terminated event fires.
    let app_for_health = app.clone();
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
        loop {
            if std::time::Instant::now() > deadline {
                eprintln!("[chimera-desktop] health probe gave up after 120s");
                return;
            }
            // Stop probing if status moved out of Starting (terminated/failed).
            {
                let state = app_for_health.state::<SidecarState>();
                let s = state.status.lock().unwrap();
                if !matches!(*s, SidecarStatus::Starting) {
                    return;
                }
            }
            if probe_health(port) {
                let state = app_for_health.state::<SidecarState>();
                let mut s = state.status.lock().unwrap();
                if matches!(*s, SidecarStatus::Starting) {
                    *s = SidecarStatus::Running;
                    eprintln!("[chimera-desktop] sidecar healthy on port {port}");
                }
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });

    Ok(())
}

fn probe_health(port: u16) -> bool {
    use std::io::{Read, Write};
    let addr = match format!("127.0.0.1:{port}").parse::<std::net::SocketAddr>() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream =
        match std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(500)) {
            Ok(s) => s,
            Err(_) => return false,
        };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(2000)));
    let req = b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(req).is_err() {
        return false;
    }
    let mut buf = [0u8; 16];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return false,
    };
    let head = std::str::from_utf8(&buf[..n]).unwrap_or("");
    head.starts_with("HTTP/1.1 200")
}

pub fn kill(app: &AppHandle) {
    let child_opt = {
        let state = app.state::<SidecarState>();
        let taken = state.child.lock().unwrap().take();
        taken
    };
    if let Some(child) = child_opt {
        let _ = child.kill();
    }
}

#[tauri::command]
pub fn sidecar_port(state: tauri::State<'_, SidecarState>) -> Option<u16> {
    eprintln!("[chimera-desktop] sidecar_port command entered");
    let result = *state.port.lock().unwrap();
    eprintln!("[chimera-desktop] sidecar_port returning {result:?}");
    result
}

#[tauri::command]
pub fn sidecar_status(state: tauri::State<'_, SidecarState>) -> SidecarStatus {
    eprintln!("[chimera-desktop] sidecar_status command entered");
    let result = state.status.lock().unwrap().clone();
    eprintln!("[chimera-desktop] sidecar_status returning {result:?}");
    result
}

#[tauri::command]
pub fn sidecar_mark_ready(state: tauri::State<'_, SidecarState>) {
    let mut s = state.status.lock().unwrap();
    if matches!(*s, SidecarStatus::Starting) {
        *s = SidecarStatus::Running;
    }
}
