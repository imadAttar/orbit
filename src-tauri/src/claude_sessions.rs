//! Read-only official Claude session observation.
use serde_json::{json, Value};
use std::path::Path;

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(3);
const MAX_STDOUT: usize = 2 * 1024 * 1024;
static SNAPSHOT_LOCK: Mutex<()> = Mutex::new(());

enum PipeEvent {
    Stdout(Result<Vec<u8>, ()>),
    Stderr,
    Overflow,
}

// Drain both pipes concurrently. Stderr is discarded, never retained or logged.
fn bounded_output(path: &Path) -> Result<Vec<u8>, &'static str> {
    let _guard = SNAPSHOT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let started = Instant::now();
    let mut command = Command::new(path);
    command
        .args(["agents", "--json", "--all"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|_| "unavailable")?;
    let mut stdout = child.stdout.take().ok_or("unavailable")?;
    let mut stderr = child.stderr.take().ok_or("unavailable")?;
    let (tx, rx) = mpsc::channel();
    let out_tx = tx.clone();
    let out_thread = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut buffer = [0; 8192];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) => {
                    let _ = out_tx.send(PipeEvent::Stdout(Ok(bytes)));
                    break;
                }
                Ok(n) if bytes.len() + n > MAX_STDOUT => {
                    let _ = out_tx.send(PipeEvent::Overflow);
                    let _ = std::io::copy(&mut stdout, &mut std::io::sink());
                    break;
                }
                Ok(n) => bytes.extend_from_slice(&buffer[..n]),
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => {
                    let _ = out_tx.send(PipeEvent::Stdout(Err(())));
                    break;
                }
            }
        }
    });
    let err_thread = std::thread::spawn(move || {
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
        let _ = tx.send(PipeEvent::Stderr);
    });
    let mut output = None;
    let mut stderr_done = false;
    let result = loop {
        while let Ok(event) = rx.try_recv() {
            match event {
                PipeEvent::Overflow => {
                    output = Some(Err("invalid_output"));
                }
                PipeEvent::Stdout(value) => output = Some(value.map_err(|_| "invalid_output")),
                PipeEvent::Stderr => stderr_done = true,
            }
        }
        if let Some(Err(error)) = output.as_ref() {
            break Err(*error);
        }
        if started.elapsed() >= TIMEOUT {
            break Err("timeout");
        }
        match child.try_wait() {
            Ok(Some(status)) if output.is_some() && stderr_done => {
                break if status.success() {
                    output.take().unwrap()
                } else {
                    Err("unavailable")
                };
            }
            Err(_) => break Err("unavailable"),
            _ => std::thread::sleep(Duration::from_millis(5)),
        }
    };
    if result.is_err() {
        // A private process group prevents inherited pipes in helpers keeping
        // reader threads alive after timeout. Never signal any Claude daemon.
        #[cfg(unix)]
        unsafe {
            unsafe extern "C" {
                fn kill(pid: i32, signal: i32) -> i32;
            }
            kill(-(child.id() as i32), 9);
        }
        let _ = child.kill();
    }
    let _ = child.wait();
    #[cfg(unix)]
    {
        let _ = out_thread.join();
        let _ = err_thread.join();
    }
    #[cfg(not(unix))]
    {
        drop(out_thread);
        drop(err_thread);
    }
    result
}

fn snapshot_from_path(path: Option<&Path>) -> Value {
    let Some(path) = path else {
        return failure("unavailable");
    };
    let output = match bounded_output(path) {
        Ok(output) => output,
        Err(error) => return failure(error),
    };
    let Ok(Value::Array(entries)) = serde_json::from_slice::<Value>(&output) else {
        return failure("invalid_output");
    };
    if entries.len() > 4096 {
        return failure("invalid_output");
    }
    let mut ids = std::collections::HashSet::new();
    let mut pids = std::collections::HashSet::new();
    let mut sessions = Vec::new();
    for entry in entries {
        if !entry.is_object()
            || !matches!(entry["kind"].as_str(), Some("interactive" | "background"))
        {
            return failure("invalid_output");
        }
        for (key, allowed) in [
            ("status", &["busy", "waiting", "idle"][..]),
            (
                "state",
                &["working", "blocked", "done", "failed", "stopped"][..],
            ),
        ] {
            if let Some(value) = entry.get(key) {
                if !value.as_str().is_some_and(|s| allowed.contains(&s)) {
                    return failure("invalid_output");
                }
            }
        }
        for key in ["sessionId", "waitingFor"] {
            if let Some(value) = entry.get(key) {
                if !value.as_str().is_some_and(|s| {
                    !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control)
                }) {
                    return failure("invalid_output");
                }
            }
        }
        if let Some(id) = entry.get("sessionId") {
            if !ids.insert(id.clone().to_string()) {
                return failure("invalid_output");
            }
        }
        if let Some(pid) = entry.get("pid") {
            let Some(pid) = pid.as_u64().filter(|n| *n > 0 && *n <= u32::MAX as u64) else {
                return failure("invalid_output");
            };
            if !pids.insert(pid) {
                return failure("invalid_output");
            }
        }
        let mut safe = serde_json::Map::new();
        for key in ["sessionId", "pid", "kind", "status", "state", "waitingFor"] {
            if let Some(value) = entry.get(key) {
                safe.insert(key.into(), value.clone());
            }
        }
        sessions.push(Value::Object(safe));
    }
    json!({"available":true,"sessions":sessions})
}
fn failure(error: &str) -> Value {
    json!({"available":false,"sessions":[],"error":error})
}

fn local_main(label: &str, url: &tauri::Url) -> bool {
    label == "main"
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost")
                && url.port().is_none())
            || (cfg!(debug_assertions)
                && url.scheme() == "http"
                && url.host_str() == Some("localhost")
                && url.port() == Some(1420)))
}

pub(crate) fn require_local_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window
        .url()
        .ok()
        .is_some_and(|url| local_main(window.label(), &url))
    {
        Ok(())
    } else {
        Err("Local main window required".into())
    }
}

#[tauri::command]
pub async fn claude_sessions_snapshot(window: tauri::WebviewWindow) -> Value {
    if require_local_main(&window).is_err() {
        return failure("unavailable");
    }
    tauri::async_runtime::spawn_blocking(|| {
        let path = crate::claude::resolve_claude_path();
        snapshot_from_path(path.as_deref().map(Path::new))
    })
    .await
    .unwrap_or_else(|_| failure("unavailable"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new(script: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "orbit-snapshot-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("claude");
            std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
            Self(dir)
        }
        fn run(&self) -> Value {
            snapshot_from_path(Some(&self.0.join("claude")))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }
    #[test]
    fn rejects_invalid_schema_and_duplicates_without_fabricating_idle() {
        for payload in [
            "{}", "[null]", "[{}]", "[{\"kind\":\"alien\"}]",
            "[{\"kind\":\"interactive\",\"pid\":-1}]",
            "[{\"kind\":\"interactive\",\"pid\":4294967296}]",
            "[{\"kind\":\"interactive\",\"status\":\"unknown\"}]",
            "[{\"kind\":\"background\",\"state\":\"idle\"}]",
            "[{\"kind\":\"interactive\",\"sessionId\":null}]",
            "[{\"kind\":\"interactive\",\"sessionId\":\"\"}]",
            "[{\"kind\":\"interactive\",\"waitingFor\":42}]",
            "[{\"kind\":\"interactive\",\"pid\":2},{\"kind\":\"interactive\",\"pid\":2}]",
            "[{\"kind\":\"background\",\"sessionId\":\"same\"},{\"kind\":\"interactive\",\"sessionId\":\"same\"}]",
        ] {
            assert_eq!(Fixture::new(&format!("printf '%s' '{payload}'")).run(), failure("invalid_output"), "{payload}");
        }
        let payload = serde_json::to_string(&vec![json!({"kind":"interactive"}); 4097]).unwrap();
        let fake = Fixture::new("cat \"$0.json\"");
        std::fs::write(fake.0.join("claude.json"), payload).unwrap();
        assert_eq!(fake.run(), failure("invalid_output"));
    }
    #[test]
    fn timeout_kills_and_reaps_child_and_inherited_pipes() {
        let fake = Fixture::new("echo $$ > \"$0.pid\"; sleep 10");
        let start = std::time::Instant::now();
        assert_eq!(fake.run(), failure("timeout"));
        assert!(start.elapsed() < std::time::Duration::from_secs(5));
        let pid = std::fs::read_to_string(fake.0.join("claude.pid")).unwrap();
        assert!(!std::process::Command::new("/bin/kill")
            .args(["-0", pid.trim()])
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success());
    }
    #[test]
    fn overflow_is_bounded_and_stderr_is_drained_without_disclosure() {
        let fake = Fixture::new("exec python3 -c 'import sys,time; sys.stdout.write(\"x\" * (2*1024*1024+1)); sys.stdout.flush(); time.sleep(10)'");
        let start = std::time::Instant::now();
        assert_eq!(fake.run(), failure("invalid_output"));
        assert!(start.elapsed() < std::time::Duration::from_secs(5));
        let fake = Fixture::new(
            "exec python3 -c 'import sys; sys.stderr.write(\"SECRET\" * 500000); print(\"[]\")'",
        );
        assert_eq!(fake.run(), json!({"available":true,"sessions":[]}));
    }
    #[test]
    fn concurrent_calls_never_overlap_children() {
        let fake =
            Fixture::new("mkdir \"$0.lock\" || exit 12; sleep 0.1; rmdir \"$0.lock\"; printf '[]'");
        std::thread::scope(|scope| {
            let a = scope.spawn(|| fake.run());
            let b = scope.spawn(|| fake.run());
            for result in [a.join().unwrap(), b.join().unwrap()] {
                assert_eq!(result, json!({"available":true,"sessions":[]}));
            }
        });
    }
    #[test]
    fn observation_ipc_is_registered_and_restricted_to_local_main() {
        let lib = include_str!("lib.rs");
        for legacy in [
            "claude::enable_session_hooks,",
            "claude::check_session_hooks,",
            "statusline::create_statusline,",
            "statusline::has_statusline,",
        ] {
            assert!(
                !lib.contains(legacy),
                "legacy configuration IPC must not be public: {legacy}"
            );
        }
        assert!(local_main(
            "main",
            &tauri::Url::parse("tauri://localhost/").unwrap()
        ));
        assert!(local_main(
            "main",
            &tauri::Url::parse("http://tauri.localhost/").unwrap()
        ));
        for (label, url) in [
            ("preview", "tauri://localhost/"),
            ("main", "https://example.com/"),
            ("main", "https://localhost/"),
            ("main", "http://localhost:9999/"),
            ("main", "file:///index.html"),
        ] {
            assert!(!local_main(label, &tauri::Url::parse(url).unwrap()));
        }
        assert!(include_str!("lib.rs").contains("claude_sessions::claude_sessions_snapshot"));
        assert!(!include_str!("lib.rs").contains("claude::remove_session_hooks"));
    }
    #[test]
    fn unavailable_errors_are_private() {
        assert_eq!(snapshot_from_path(None), failure("unavailable"));
        assert_eq!(
            snapshot_from_path(Some(Path::new("/does-not-exist/claude"))),
            failure("unavailable")
        );
        assert_eq!(
            Fixture::new("echo SECRET >&2; exit 2").run(),
            failure("unavailable")
        );
        assert_eq!(
            Fixture::new("printf 'not json'").run(),
            failure("invalid_output")
        );
    }
    #[test]
    fn official_command_projects_only_safe_fields() {
        let fake = Fixture::new(
            r#"[ "$*" = 'agents --json --all' ] || exit 19
printf '%s' '[{"kind":"interactive","sessionId":"abc","pid":42,"status":"waiting","waitingFor":"permission prompt","name":"SECRET","cwd":"SECRET","prompt":"SECRET","extra":true},{"kind":"background","state":"done"}]'"#,
        );
        assert_eq!(
            fake.run(),
            json!({"available":true,"sessions":[{"kind":"interactive","sessionId":"abc","pid":42,"status":"waiting","waitingFor":"permission prompt"},{"kind":"background","state":"done"}]})
        );
    }
}
