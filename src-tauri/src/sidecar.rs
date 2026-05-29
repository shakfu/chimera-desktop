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

use crate::debug;

// Kill-on-drop wrapper around CommandChild. tauri-plugin-shell's
// CommandChild does NOT kill the child on drop by default, so when the
// Tauri parent dies via Ctrl-C / panic / SIGTERM the chimera sidecar
// becomes an orphan. Wrapping it in ChildGuard means dropping
// SidecarState (which happens during graceful shutdown) propagates a
// kill. Hard kills of the parent (SIGKILL) still leak; only the OS can
// reap those.
pub struct ChildGuard(Option<CommandChild>);

impl ChildGuard {
    pub fn new(child: CommandChild) -> Self {
        ChildGuard(Some(child))
    }

    pub fn into_child(mut self) -> Option<CommandChild> {
        self.0.take()
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(child) = self.0.take() {
            debug!("ChildGuard dropping — killing chimera child");
            let _ = child.kill();
        }
    }
}

#[derive(Default)]
pub struct SidecarState {
    pub port: Mutex<Option<u16>>,
    pub child: Mutex<Option<ChildGuard>>,
    pub status: Mutex<SidecarStatus>,
    // Optional modality routes enabled at spawn time. The webview can't
    // infer these from /props (its `modalities` field describes the chat
    // model's multimodal *inputs*, not the standalone transcription /
    // image routes), so we record what we passed to `serve` and expose it
    // via the sidecar_features command.
    pub features: Mutex<SidecarFeatures>,
}

// Which optional chimera routes the sidecar was started with. Extend as
// more modality panels (rerank, lora, ...) get wired.
#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct SidecarFeatures {
    // /v1/audio/transcriptions + /v1/audio/translations (--enable-audio).
    pub audio: bool,
    // /v1/images/generations (--enable-image).
    pub image: bool,
    // /v1/vector_stores/* (--enable-rag).
    pub rag: bool,
    // /v1/rerank (--reranking).
    pub rerank: bool,
    // /lora-adapters populated (--lora). The route is always mounted; this
    // flag reflects whether any adapter was actually loaded at spawn.
    pub lora: bool,
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

// Resolve a (possibly relative) model path against the process cwd and
// canonicalize it, verifying the file is readable. The chimera child
// inherits Tauri's cwd (not the user's shell cwd), so a relative path
// would otherwise resolve against the wrong directory and chimera would
// exit with "failed to load model". Returning Err here lets the caller
// turn a bad path into a useful message instead of a silent post-spawn
// exit.
fn resolve_model_path(raw: &str) -> Result<String, String> {
    let path = std::path::PathBuf::from(raw);
    let absolute = if path.is_absolute() {
        path
    } else {
        let cwd = std::env::current_dir()
            .map_err(|e| format!("cannot read current dir to resolve model path: {e}"))?;
        cwd.join(&path)
    };
    let canonical = std::fs::canonicalize(&absolute)
        .map_err(|e| format!("model file not readable at {}: {e}", absolute.display()))?;
    Ok(canonical.to_string_lossy().into_owned())
}

// Conditionally enable an optional modality route. When `env_var` is set to a
// non-empty, readable model path, push `flag <path>` onto `args` and return
// true. A bad path logs a warning and returns false rather than failing the
// whole sidecar — a broken modality model must not take down chat. `label` is
// used only for the log line.
fn enable_optional_model(args: &mut Vec<String>, env_var: &str, flag: &str, label: &str) -> bool {
    match std::env::var(env_var) {
        Ok(raw) if !raw.trim().is_empty() => match resolve_model_path(&raw) {
            Ok(path) => {
                eprintln!("[chimera-desktop] {label} enabled: {path}");
                args.push(flag.to_string());
                args.push(path);
                true
            }
            Err(e) => {
                eprintln!(
                    "[chimera-desktop] {env_var} set but unusable: {e}; {label} route disabled"
                );
                false
            }
        },
        _ => false,
    }
}

// Parse CHIMERA_DESKTOP_LORA — a comma-separated list of `path[:scale]`
// entries — and push a `--lora <resolved>[:scale]` arg per usable adapter.
// Unlike the single-file modality models this is a repeatable list, so it
// can't reuse enable_optional_model. Each path is resolved against our cwd
// (the chimera child inherits Tauri's cwd, not the shell's). A bad path warns
// and skips that one adapter rather than failing the whole sidecar. Returns
// true if at least one adapter was added. Note `/lora-adapters` is mounted
// unconditionally by chimera; this only controls whether anything is loaded.
fn enable_lora_adapters(args: &mut Vec<String>, env_var: &str) -> bool {
    let raw = match std::env::var(env_var) {
        Ok(v) if !v.trim().is_empty() => v,
        _ => return false,
    };
    let mut added = false;
    for entry in raw.split(',') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        // Split an optional trailing `:scale` (a float). A bare path has no
        // colon; `path:scale` splits on the last colon only when the suffix
        // parses as a number (so a Windows-style drive path isn't mangled).
        let (path_part, scale_part) = match entry.rsplit_once(':') {
            Some((p, s)) if s.parse::<f32>().is_ok() => (p, Some(s)),
            _ => (entry, None),
        };
        match resolve_model_path(path_part) {
            Ok(resolved) => {
                let spec = match scale_part {
                    Some(s) => format!("{resolved}:{s}"),
                    None => resolved,
                };
                eprintln!("[chimera-desktop] lora adapter enabled: {spec}");
                args.push("--lora".to_string());
                args.push(spec);
                added = true;
            }
            Err(e) => {
                eprintln!("[chimera-desktop] {env_var} entry unusable: {e}; skipping adapter");
            }
        }
    }
    added
}

pub fn spawn(app: &AppHandle) -> Result<(), String> {
    let model_raw = std::env::var("CHIMERA_DESKTOP_MODEL").map_err(|_| {
        "CHIMERA_DESKTOP_MODEL is not set; export it to a .gguf path and restart".to_string()
    })?;

    // The bundled chimera child inherits Tauri's cwd, which is generally not
    // the user's shell cwd (and certainly not the chimera-desktop repo root
    // when launched via `make run` / `npm run tauri dev` / a Finder-launched
    // bundle). Resolve against *our* cwd up front and verify the file exists
    // so the error surface is a Tauri-level `Failed(...)` with a useful
    // message rather than a silent post-spawn exit.
    let model = resolve_model_path(&model_raw)?;
    // Unconditional: a one-line confirmation the model resolved to where
    // the user expected is high-signal for first-launch debugging and
    // costs nothing.
    eprintln!("[chimera-desktop] resolved model path: {model}");

    let port = pick_free_port().map_err(|e| format!("port pick failed: {e}"))?;

    // --persist-chats is load-bearing for the chimera-desktop value
    // proposition: it tells chimera to save every chat turn to its
    // SQLite store, which is what powers the persisted-chat browser
    // at /#/chimera/chats. Without this flag, /v1/chats* returns 404
    // ("chat history not enabled") and the chats panel is empty.
    let mut args: Vec<String> = vec![
        "serve".into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "-m".into(),
        model,
        "--persist-chats".into(),
    ];

    // Optional modality routes. Each is driven by a CHIMERA_DESKTOP_*_MODEL
    // env var pointing at the relevant model; when set+readable we pass the
    // matching `serve` flag so chimera mounts the route. All are optional —
    // an unset/bad path leaves that route off without failing the sidecar.
    //   audio  --enable-audio  -> /v1/audio/{transcriptions,translations}
    //   image  --enable-image  -> /v1/images/generations
    //   rag    --enable-rag    -> /v1/vector_stores/*
    //   rerank --reranking     -> /v1/rerank
    //   lora   --lora          -> /lora-adapters (always mounted; populated)
    let mut features = SidecarFeatures::default();
    features.audio = enable_optional_model(
        &mut args,
        "CHIMERA_DESKTOP_AUDIO_MODEL",
        "--enable-audio",
        "audio",
    );
    features.image = enable_optional_model(
        &mut args,
        "CHIMERA_DESKTOP_IMAGE_MODEL",
        "--enable-image",
        "image",
    );
    features.rag = enable_optional_model(
        &mut args,
        "CHIMERA_DESKTOP_RAG_MODEL",
        "--enable-rag",
        "rag",
    );
    features.rerank = enable_optional_model(
        &mut args,
        "CHIMERA_DESKTOP_RERANK_MODEL",
        "--reranking",
        "rerank",
    );
    features.lora = enable_lora_adapters(&mut args, "CHIMERA_DESKTOP_LORA");

    let cmd = app
        .shell()
        .sidecar("chimera")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?
        .args(args);

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;

    let state = app.state::<SidecarState>();
    *state.port.lock().unwrap() = Some(port);
    *state.child.lock().unwrap() = Some(ChildGuard::new(child));
    *state.status.lock().unwrap() = SidecarStatus::Starting;
    *state.features.lock().unwrap() = features;

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
                    // Unconditional: terminated child is always
                    // newsworthy. The status flip is also visible in
                    // the UI status bar.
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
                // Unconditional: a giving-up message is an error condition
                // worth surfacing even without CHIMERA_DESKTOP_DEBUG.
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
                    // Unconditional: tells the user the sidecar is up
                    // and what port it's on. Matched in `make run`
                    // troubleshooting docs.
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

// Try graceful shutdown via POST /v1/chimera/shutdown first; fall back
// to SIGKILL if the child hasn't exited within a short deadline.
//
// chimera's shutdown handler returns 202 immediately, then on a
// detached thread (after ~150 ms) signals the same termination path
// SIGINT would. We hit the endpoint, then poll for the child to exit
// — if it doesn't within ~2.5 s, the ChildGuard's Drop / explicit
// child.kill() takes over.
pub fn kill(app: &AppHandle) {
    // Snapshot the port so we can POST shutdown before taking the
    // child handle. If the port is None the child can't have a HTTP
    // server up, so skip straight to the kill path.
    let port_opt = {
        let state = app.state::<SidecarState>();
        let port = *state.port.lock().unwrap();
        port
    };

    if let Some(port) = port_opt {
        send_shutdown(port);
        // Poll for the child to actually exit — chimera's handler
        // is async (responds 202, terminates 150 ms later). Check
        // for ~2.5 s before falling back to SIGKILL.
        for _ in 0..25 {
            if !port_listening(port) {
                debug!("chimera exited via /v1/chimera/shutdown");
                // Drop the ChildGuard without explicitly killing —
                // the process is already gone. into_child() returns
                // the CommandChild whose own Drop is a no-op.
                let _ = take_child(app).and_then(|g| g.into_child());
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        debug!("chimera did not exit gracefully within 2.5s; SIGKILL");
    }

    if let Some(guard) = take_child(app) {
        if let Some(child) = guard.into_child() {
            let _ = child.kill();
        }
    }
}

fn take_child(app: &AppHandle) -> Option<ChildGuard> {
    let state = app.state::<SidecarState>();
    let taken = state.child.lock().unwrap().take();
    taken
}

// Fire-and-forget POST /v1/chimera/shutdown. We don't need the
// response body — we'll observe the actual exit by polling the port.
fn send_shutdown(port: u16) {
    use std::io::Write;
    let addr = match format!("127.0.0.1:{port}").parse::<std::net::SocketAddr>() {
        Ok(a) => a,
        Err(_) => return,
    };
    let mut stream = match std::net::TcpStream::connect_timeout(
        &addr,
        std::time::Duration::from_millis(500),
    ) {
        Ok(s) => s,
        Err(_) => return,
    };
    let _ = stream.set_write_timeout(Some(std::time::Duration::from_millis(500)));
    let req = b"POST /v1/chimera/shutdown HTTP/1.1\r\n\
                Host: 127.0.0.1\r\n\
                Content-Length: 0\r\n\
                Connection: close\r\n\r\n";
    let _ = stream.write_all(req);
    // Don't bother reading the response — by the time it arrives the
    // child is on its way out and the read may race the close.
}

// True iff something is still listening on the port. chimera closes
// its HTTP listener as part of shutdown, so this is our exit signal.
fn port_listening(port: u16) -> bool {
    let addr = match format!("127.0.0.1:{port}").parse::<std::net::SocketAddr>() {
        Ok(a) => a,
        Err(_) => return false,
    };
    std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(100)).is_ok()
}

#[tauri::command]
pub fn sidecar_port(state: tauri::State<'_, SidecarState>) -> Option<u16> {
    let result = *state.port.lock().unwrap();
    debug!("sidecar_port -> {result:?}");
    result
}

#[tauri::command]
pub fn sidecar_status(state: tauri::State<'_, SidecarState>) -> SidecarStatus {
    let result = state.status.lock().unwrap().clone();
    debug!("sidecar_status -> {result:?}");
    result
}

#[tauri::command]
pub fn sidecar_features(state: tauri::State<'_, SidecarState>) -> SidecarFeatures {
    let result = state.features.lock().unwrap().clone();
    debug!("sidecar_features -> {result:?}");
    result
}

#[tauri::command]
pub fn sidecar_mark_ready(state: tauri::State<'_, SidecarState>) {
    let mut s = state.status.lock().unwrap();
    if matches!(*s, SidecarStatus::Starting) {
        *s = SidecarStatus::Running;
    }
}

#[cfg(test)]
mod tests {
    use super::enable_lora_adapters;
    use std::fs;

    // Each test uses a unique env var name and a unique temp dir so the tests
    // are safe to run in parallel: they never share the global process
    // environment for the same key, and never collide on the filesystem.
    // `enable_lora_adapters` reads the env var by name (a parameter), so a
    // per-test name fully isolates the global mutation.
    struct Fixture {
        dir: std::path::PathBuf,
        env_var: &'static str,
    }

    impl Fixture {
        fn new(tag: &'static str) -> Self {
            let dir = std::env::temp_dir().join(format!("chimera-lora-test-{tag}"));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Fixture { dir, env_var: tag }
        }

        // Create an adapter file and return its canonical absolute path — what
        // `resolve_model_path` produces (e.g. /var -> /private/var on macOS),
        // so callers can build the exact `--lora` arg the function should push.
        fn touch(&self, name: &str) -> String {
            let p = self.dir.join(name);
            fs::write(&p, b"adapter").unwrap();
            fs::canonicalize(&p).unwrap().to_string_lossy().into_owned()
        }

        // Run enable_lora_adapters with `value` (None = leave the var unset).
        fn run(&self, value: Option<&str>) -> (Vec<String>, bool) {
            match value {
                Some(v) => std::env::set_var(self.env_var, v),
                None => std::env::remove_var(self.env_var),
            }
            let mut args = Vec::new();
            let added = enable_lora_adapters(&mut args, self.env_var);
            std::env::remove_var(self.env_var);
            (args, added)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
            std::env::remove_var(self.env_var);
        }
    }

    // A non-absolute path resolves against the process cwd, which is not this
    // dir; tests therefore always pass absolute paths (what the temp files are).
    fn assert_no_args(args: &[String]) {
        assert!(args.is_empty(), "expected no args, got {args:?}");
    }

    #[test]
    fn unset_var_adds_nothing() {
        let fx = Fixture::new("CHIMERA_DESKTOP_LORA_TEST_UNSET");
        let (args, added) = fx.run(None);
        assert!(!added);
        assert_no_args(&args);
    }

    #[test]
    fn blank_var_adds_nothing() {
        let fx = Fixture::new("CHIMERA_DESKTOP_LORA_TEST_BLANK");
        let (args, added) = fx.run(Some("   "));
        assert!(!added);
        assert_no_args(&args);
    }

    #[test]
    fn bare_path_adds_lora_flag_without_scale() {
        let fx = Fixture::new("CHIMERA_DESKTOP_LORA_TEST_BARE");
        let resolved = fx.touch("a.gguf");
        let (args, added) = fx.run(Some(&resolved));
        assert!(added);
        assert_eq!(args, vec!["--lora".to_string(), resolved]);
    }

    #[test]
    fn trailing_scale_is_preserved() {
        let fx = Fixture::new("CHIMERA_DESKTOP_LORA_TEST_SCALE");
        let resolved = fx.touch("b.gguf");
        let (args, added) = fx.run(Some(&format!("{resolved}:0.8")));
        assert!(added);
        assert_eq!(args, vec!["--lora".to_string(), format!("{resolved}:0.8")]);
    }

    #[test]
    fn multiple_entries_each_get_their_own_flag() {
        let fx = Fixture::new("CHIMERA_DESKTOP_LORA_TEST_MULTI");
        let a = fx.touch("a.gguf");
        let b = fx.touch("b.gguf");
        let (args, added) = fx.run(Some(&format!("{a}:0.5,{b}")));
        assert!(added);
        assert_eq!(
            args,
            vec![
                "--lora".to_string(),
                format!("{a}:0.5"),
                "--lora".to_string(),
                b,
            ]
        );
    }

    #[test]
    fn blank_entries_between_commas_are_skipped() {
        let fx = Fixture::new("CHIMERA_DESKTOP_LORA_TEST_COMMAS");
        let a = fx.touch("a.gguf");
        // Leading, doubled, and trailing commas plus surrounding whitespace.
        let (args, added) = fx.run(Some(&format!(" ,{a} , , ")));
        assert!(added);
        assert_eq!(args, vec!["--lora".to_string(), a]);
    }

    #[test]
    fn unreadable_path_is_skipped_but_good_ones_remain() {
        let fx = Fixture::new("CHIMERA_DESKTOP_LORA_TEST_PARTIAL");
        let good = fx.touch("good.gguf");
        let missing = fx.dir.join("missing.gguf").to_string_lossy().into_owned();
        let (args, added) = fx.run(Some(&format!("{missing},{good}")));
        assert!(added, "the one good adapter should still be added");
        assert_eq!(args, vec!["--lora".to_string(), good]);
    }

    #[test]
    fn all_paths_unreadable_returns_false() {
        let fx = Fixture::new("CHIMERA_DESKTOP_LORA_TEST_ALLBAD");
        let missing = fx.dir.join("nope.gguf").to_string_lossy().into_owned();
        let (args, added) = fx.run(Some(&missing));
        assert!(!added);
        assert_no_args(&args);
    }

    // A non-numeric suffix after the last colon must NOT be split off as a
    // scale — the whole entry is treated as a path. This guards Windows-style
    // `C:\models\x.gguf` drive paths from being mangled into path `C` + scale
    // `\models\x.gguf`. We assert the entry is treated as one (non-existent)
    // path and skipped, rather than silently producing a `--lora C` arg.
    #[test]
    fn non_numeric_suffix_is_part_of_the_path_not_a_scale() {
        let fx = Fixture::new("CHIMERA_DESKTOP_LORA_TEST_DRIVE");
        let (args, added) = fx.run(Some("C:\\models\\x.gguf"));
        assert!(!added);
        assert!(
            !args.iter().any(|a| a == "C"),
            "drive letter was mangled into a path: {args:?}"
        );
        assert_no_args(&args);
    }

    // A path that genuinely exists but whose basename ends in `:<number>` would
    // be ambiguous; we document the chosen behavior — the numeric suffix wins
    // and is treated as a scale. (resolve_model_path then fails on the
    // stripped path, so nothing is added.) This pins the rsplit_once contract.
    #[test]
    fn numeric_suffix_is_always_treated_as_scale() {
        let fx = Fixture::new("CHIMERA_DESKTOP_LORA_TEST_NUMSUFFIX");
        // No file named "a.gguf" relative split target exists, so this resolves
        // to a missing path and is skipped — confirming the suffix was split.
        let entry = fx.dir.join("a.gguf").to_string_lossy().into_owned();
        let (args, added) = fx.run(Some(&format!("{entry}:2")));
        // The file "<dir>/a.gguf" does not exist (we never touched it), so even
        // with the scale stripped the path is unreadable -> skipped.
        assert!(!added);
        assert_no_args(&args);
    }
}
