use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    generation_id: Option<String>,
    master: Box<dyn MasterPty + Send>,
    input: PtyInput,
    child: Box<dyn Child + Send + Sync>,
    killed: Arc<AtomicBool>,
}

// Bound both queued message count and message size (at most 8 MiB queued).
const PTY_INPUT_CAPACITY: usize = 32;
const PTY_INPUT_MAX_BYTES: usize = 256 * 1024;

struct PtyInput {
    sender: SyncSender<String>,
    killed: Arc<AtomicBool>,
}

impl PtyInput {
    // Success acknowledges admission, not completion of the underlying PTY write.
    fn enqueue(&self, data: String) -> Result<(), String> {
        if self.killed.load(Ordering::Relaxed) {
            return Err("Écriture PTY indisponible : session fermée ou erreur d’écriture.".into());
        }
        if data.len() > PTY_INPUT_MAX_BYTES {
            return Err("Écriture PTY trop volumineuse : limite de 256 Kio par envoi.".into());
        }
        self.sender.try_send(data).map_err(|error| match error {
            TrySendError::Full(_) => {
                "File d’écriture PTY saturée : entrée refusée, réessayez après vidage.".into()
            }
            TrySendError::Disconnected(_) => {
                "Écriture PTY indisponible : session fermée ou erreur d’écriture.".into()
            }
        })
    }
}

#[cfg(test)]
fn start_pty_writer(
    writer: Box<dyn Write + Send>,
    killed: Arc<AtomicBool>,
) -> (PtyInput, thread::JoinHandle<()>) {
    start_pty_writer_with_failure(writer, killed, || {})
}

fn start_pty_writer_with_failure(
    mut writer: Box<dyn Write + Send>,
    killed: Arc<AtomicBool>,
    on_failure: impl FnOnce() + Send + 'static,
) -> (PtyInput, thread::JoinHandle<()>) {
    let (sender, receiver) = mpsc::sync_channel::<String>(PTY_INPUT_CAPACITY);
    let worker_killed = Arc::clone(&killed);
    let worker = thread::spawn(move || {
        while let Ok(data) = receiver.recv() {
            if worker_killed.load(Ordering::Relaxed) {
                break;
            }
            if writer
                .write_all(data.as_bytes())
                .and_then(|_| writer.flush())
                .is_err()
            {
                // Never log terminal contents or OS errors that could contain secrets.
                tracing::warn!(
                    "Échec d’écriture PTY : file fermée, entrées en attente abandonnées."
                );
                // The write/flush may have blocked while this generation was killed.
                if !worker_killed.load(Ordering::Relaxed) {
                    on_failure();
                }
                break;
            }
        }
    });
    (PtyInput { sender, killed }, worker)
}

// Admission stays atomic with session removal/replacement, but never performs I/O
// or waits for queue capacity while holding the global session map.
fn enqueue_pty_input<T>(
    sessions: &Mutex<HashMap<String, T>>,
    session_id: &str,
    data: String,
    input: impl FnOnce(&T) -> &PtyInput,
) -> Result<(), String> {
    let sessions = sessions.lock().unwrap_or_else(|e| e.into_inner());
    let session = sessions.get(session_id).ok_or_else(|| {
        "Session PTY introuvable : le processus est peut-être terminé.".to_string()
    })?;
    input(session).enqueue(data)
}

pub struct PtyState {
    // Covers the entire remove -> spawn -> insert transition, including kill.
    transitions: Mutex<()>,
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            transitions: Mutex::new(()),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PtyOutput {
    session_id: String,
    generation_id: Option<String>,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
struct PtyExit {
    session_id: String,
    generation_id: Option<String>,
    exit_code: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
struct PtyInputError {
    session_id: String,
    generation_id: Option<String>,
}

/// Get the user home directory cross-platform.
pub fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default()
}

// Tauri command arguments are the public invoke boundary; keep each field explicit.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn spawn_pty(
    app: AppHandle,
    state: State<'_, PtyState>,
    session_id: String,
    project_dir: String,
    cols: u16,
    rows: u16,
    claude_session_id: Option<String>,
    resume_mode: Option<bool>,
    session_name: Option<String>,
    dangerous_mode: Option<bool>,
    shell_only: Option<bool>,
    generation_id: Option<String>,
) -> Result<(), String> {
    tracing::info!(session_id = %session_id, project_dir = %project_dir, cols, rows, shell_only = shell_only.unwrap_or(false), "Spawning PTY");
    if !std::path::Path::new(&project_dir).is_dir() {
        return Err(format!("Repertoire projet introuvable : {project_dir}"));
    }

    let _transition = state.transitions.lock().unwrap_or_else(|e| e.into_inner());

    // Kill any existing PTY for this session_id so we don't leak a phantom
    // child that keeps emitting output into the new terminal (e.g. mode toggle).
    {
        let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut existing) = sessions.remove(&session_id) {
            tracing::info!(session_id = %session_id, "Killing previous PTY before respawn");
            existing.killed.store(true, Ordering::Relaxed);
            if let Err(e) = existing.child.kill() {
                tracing::warn!(session_id = %session_id, "Failed to kill previous PTY child: {e}");
            }
            let sid = session_id.clone();
            thread::spawn(move || {
                if let Err(e) = existing.child.wait() {
                    tracing::warn!(session_id = %sid, "Failed to wait on previous PTY child: {e}");
                }
            });
        }
    }

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Shell-only mode: spawn user's default shell instead of Claude
    let mut cmd = if shell_only.unwrap_or(false) {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "windows") {
                "cmd.exe".to_string()
            } else {
                "/bin/sh".to_string()
            }
        });
        CommandBuilder::new(shell)
    } else {
        let claude_bin = crate::claude::resolve_claude_path()
            .ok_or_else(|| "Unable to spawn claude because it doesn't exist on the filesystem and was not found in PATH".to_string())?;

        let mut c = CommandBuilder::new(&claude_bin);

        if let Some(ref cid) = claude_session_id {
            if resume_mode.unwrap_or(true) {
                c.arg("--resume");
            } else {
                c.arg("--session-id");
            }
            c.arg(cid);
        }

        if let Some(ref name) = session_name {
            c.arg("--name");
            c.arg(name);
        }

        if dangerous_mode.unwrap_or(false) {
            c.arg("--dangerously-skip-permissions");
        }

        c
    };

    cmd.cwd(&project_dir);

    // Inherit only safe environment variables
    let allowed_vars = [
        "HOME",
        "USERPROFILE",
        "USER",
        "USERNAME",
        "LOGNAME",
        "PATH",
        "SHELL",
        "TERM",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "EDITOR",
        "VISUAL",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "ANTHROPIC_API_KEY",
        "CLAUDE_CONFIG_DIR",
        "TMPDIR",
        "TMP",
        "TEMP",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "SSH_AUTH_SOCK",
        "SSH_AGENT_PID",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "COLORTERM",
        "TERM_PROGRAM",
    ];
    for (key, value) in std::env::vars() {
        if allowed_vars.contains(&key.as_str())
            || key.starts_with("CLAUDE_")
            || key.starts_with("NVM_")
            || key.starts_with("FNM_")
        {
            cmd.env(key, value);
        }
    }

    let path_env = std::env::var("PATH").unwrap_or_default();
    let home = home_dir();

    #[cfg(not(target_os = "windows"))]
    let (extra_paths, separator): (Vec<String>, &str) = (
        vec![
            format!("{home}/.local/bin"),
            format!("{home}/.npm-global/bin"),
            "/opt/homebrew/bin".into(),
            "/usr/local/bin".into(),
        ],
        ":",
    );

    #[cfg(target_os = "windows")]
    let (extra_paths, separator): (Vec<String>, &str) = (
        vec![
            format!("{home}\\AppData\\Roaming\\npm"),
            "C:\\Program Files\\nodejs".into(),
        ],
        ";",
    );

    let full_path = std::iter::once(&path_env)
        .chain(
            extra_paths
                .iter()
                .filter(|p| !path_env.contains(p.as_str())),
        )
        .cloned()
        .collect::<Vec<_>>()
        .join(separator);
    cmd.env("PATH", full_path);
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn claude: {}", e))?;

    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;

    let killed = Arc::new(AtomicBool::new(false));
    let killed_clone = Arc::clone(&killed);
    // The worker owns only the writer, never the master, child or session map.
    // Do not join it on kill: an OS write may still be blocked.
    let input_error_app = app.clone();
    let input_error = PtyInputError {
        session_id: session_id.clone(),
        generation_id: generation_id.clone(),
    };
    let (input, _writer_worker) =
        start_pty_writer_with_failure(writer, Arc::clone(&killed), move || {
            let _ = input_error_app.emit("pty-input-error", input_error);
        });

    {
        let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
        sessions.insert(
            session_id.clone(),
            PtySession {
                generation_id: generation_id.clone(),
                master: pair.master,
                input,
                child,
                killed,
            },
        );
    }

    let sid = session_id.clone();
    let app_clone = app.clone();
    let sessions_arc = Arc::clone(&state.sessions);
    thread::spawn(move || {
        read_pty_output(
            reader,
            sid,
            app_clone,
            sessions_arc,
            killed_clone,
            generation_id,
        );
    });

    Ok(())
}

/// Count how many trailing bytes form an incomplete UTF-8 sequence.
fn incomplete_utf8_tail(buf: &[u8]) -> usize {
    for i in 1..=3.min(buf.len()) {
        let b = buf[buf.len() - i];
        if b & 0x80 == 0 {
            return 0;
        }
        if b & 0xC0 == 0xC0 {
            let expected_len = if b & 0xF8 == 0xF0 {
                4
            } else if b & 0xF0 == 0xE0 {
                3
            } else if b & 0xE0 == 0xC0 {
                2
            } else {
                return 0;
            };
            if i < expected_len {
                return i;
            }
            return 0;
        }
    }
    0
}

fn read_pty_output(
    mut reader: Box<dyn Read + Send>,
    session_id: String,
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    killed: Arc<AtomicBool>,
    generation_id: Option<String>,
) {
    let mut buf = [0u8; 4096];
    let mut leftover = Vec::new();
    loop {
        if killed.load(Ordering::Relaxed) {
            tracing::info!(session_id = %session_id, "Reader stopping: kill flag set");
            break;
        }
        let offset = leftover.len();
        debug_assert!(
            offset <= 3,
            "leftover should be at most 3 bytes from incomplete UTF-8"
        );
        if offset > 0 && offset < buf.len() {
            buf[..offset].copy_from_slice(&leftover);
            leftover.clear();
        } else if offset >= buf.len() {
            leftover.clear();
        }
        match reader.read(&mut buf[offset..]) {
            Ok(0) => break,
            Ok(n) => {
                // read() may have blocked while this generation was killed.
                if killed.load(Ordering::Relaxed) {
                    break;
                }
                let total = offset + n;
                let tail = incomplete_utf8_tail(&buf[..total]);
                let valid_end = total - tail;
                if tail > 0 {
                    leftover.extend_from_slice(&buf[valid_end..total]);
                }
                let data = String::from_utf8_lossy(&buf[..valid_end]).to_string();
                if !data.is_empty() && !killed.load(Ordering::Relaxed) {
                    let _ = app.emit(
                        "pty-output",
                        PtyOutput {
                            session_id: session_id.clone(),
                            generation_id: generation_id.clone(),
                            data,
                        },
                    );
                }
            }
            Err(e) => {
                if !killed.load(Ordering::Relaxed) {
                    tracing::warn!(session_id = %session_id, "PTY read error: {e}");
                }
                break;
            }
        }
    }
    // Only emit session-ended message if not explicitly killed by user
    if !killed.load(Ordering::Relaxed) {
        let _ = app.emit(
            "pty-output",
            PtyOutput {
                session_id: session_id.clone(),
                generation_id: generation_id.clone(),
                data: "\r\n\x1b[33m[Session terminee — cree une nouvelle session pour continuer]\x1b[0m\r\n"
                    .to_string(),
            },
        );
    }
    // Remove only THIS reader's process. A respawn may already have installed
    // another PTY under the same session ID while the old reader was exiting.
    if !killed.load(Ordering::Relaxed) {
        let finished = {
            let mut map = sessions.lock().unwrap_or_else(|e| e.into_inner());
            if map
                .get(&session_id)
                .is_some_and(|s| Arc::ptr_eq(&s.killed, &killed))
            {
                map.remove(&session_id)
            } else {
                None
            }
        };
        if let Some(mut finished) = finished {
            let exit_code = finished.child.wait().ok().map(|status| status.exit_code());
            if !killed.load(Ordering::Relaxed) {
                let _ = app.emit(
                    "pty-exit",
                    PtyExit {
                        session_id,
                        generation_id,
                        exit_code,
                    },
                );
            }
        }
    }
}

#[tauri::command]
pub fn write_pty(
    state: State<'_, PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    enqueue_pty_input(&state.sessions, &session_id, data, |session| &session.input)
}

#[tauri::command]
pub fn resize_pty(
    state: State<'_, PtyState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session {session_id} not found (process may have exited)"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize error: {}", e))?;
    Ok(())
}

/// Remove under the caller's map lock, so matching and removal are atomic.
fn remove_session_for_generation<T>(
    sessions: &mut HashMap<String, T>,
    session_id: &str,
    expected: Option<&str>,
    generation: impl FnOnce(&T) -> Option<&str>,
) -> Option<T> {
    if sessions
        .get(session_id)
        .is_some_and(|session| expected.is_none() || generation(session) == expected)
    {
        sessions.remove(session_id)
    } else {
        None
    }
}

#[tauri::command]
pub fn kill_pty(
    state: State<'_, PtyState>,
    session_id: String,
    generation_id: Option<String>,
) -> Result<(), String> {
    tracing::info!(session_id = %session_id, "Killing PTY");
    let _transition = state.transitions.lock().unwrap_or_else(|e| e.into_inner());
    let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut session) =
        remove_session_for_generation(&mut sessions, &session_id, generation_id.as_deref(), |s| {
            s.generation_id.as_deref()
        })
    {
        // Signal reader thread to stop before killing the child
        session.killed.store(true, Ordering::Relaxed);
        if let Err(e) = session.child.kill() {
            tracing::warn!(session_id = %session_id, "Failed to kill PTY child: {e}");
        }
        // Wait in background thread to avoid blocking the main thread / UI
        let sid = session_id.clone();
        thread::spawn(move || {
            if let Err(e) = session.child.wait() {
                tracing::warn!(session_id = %sid, "Failed to wait on PTY child: {e}");
            }
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{incomplete_utf8_tail, remove_session_for_generation, PtyExit};
    use std::collections::HashMap;

    // A channel gate controls blocking; no sleeps or native PTY/processes.
    struct BlockedWriter {
        entered: std::sync::mpsc::Sender<()>,
        release: std::sync::mpsc::Receiver<()>,
    }

    impl std::io::Write for BlockedWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.entered.send(()).unwrap();
            self.release.recv().unwrap();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn blocked_writer_does_not_hold_map_or_prevent_other_session_and_removal() {
        use super::{enqueue_pty_input, start_pty_writer};
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc, Mutex,
        };
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let killed = Arc::new(AtomicBool::new(false));
        let (input, worker) = start_pty_writer(
            Box::new(BlockedWriter {
                entered: entered_tx,
                release: release_rx,
            }),
            Arc::clone(&killed),
        );
        let (other, other_worker) =
            start_pty_writer(Box::new(std::io::sink()), Arc::new(AtomicBool::new(false)));
        let sessions = Arc::new(Mutex::new(HashMap::from([
            ("A".into(), input),
            ("B".into(), other),
        ])));
        let command_sessions = Arc::clone(&sessions);
        let command = std::thread::spawn(move || {
            enqueue_pty_input(&command_sessions, "A", "input".into(), |s| s)
        });
        entered_rx.recv().unwrap();
        // try_lock detects the regression deterministically, without a timeout.
        let accessible = match sessions.try_lock() {
            Ok(mut map) => {
                let b_accessible = map.get("B").unwrap().enqueue("B".into()).is_ok();
                killed.store(true, Ordering::Relaxed);
                let removed = map.remove("A").is_some();
                b_accessible && removed
            }
            Err(_) => false,
        };
        // Always release and join before assertions: no worker leaks on failure.
        release_tx.send(()).unwrap();
        let sent = command.join().unwrap();
        drop(sessions);
        worker.join().unwrap();
        other_worker.join().unwrap();
        assert!(sent.is_ok());
        assert!(
            accessible,
            "blocked A must not prevent access B or removal A"
        );
    }

    struct RecordingWriter {
        events: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
        gate: Option<BlockedWriter>,
    }

    impl std::io::Write for RecordingWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if let Some(mut gate) = self.gate.take() {
                std::io::Write::write(&mut gate, bytes)?;
            }
            self.events
                .lock()
                .unwrap()
                .push(String::from_utf8(bytes.to_vec()).unwrap());
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.events.lock().unwrap().push("flush".into());
            Ok(())
        }
    }

    #[test]
    fn bounded_queue_preserves_fifo_and_reports_saturation_without_losing_accepted_input() {
        use super::{start_pty_writer, PTY_INPUT_CAPACITY};
        use std::sync::{atomic::AtomicBool, mpsc, Arc, Mutex};
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let events = Arc::new(Mutex::new(Vec::new()));
        let (input, worker) = start_pty_writer(
            Box::new(RecordingWriter {
                events: Arc::clone(&events),
                gate: Some(BlockedWriter {
                    entered: entered_tx,
                    release: release_rx,
                }),
            }),
            Arc::new(AtomicBool::new(false)),
        );
        input.enqueue("first".into()).unwrap();
        entered_rx.recv().unwrap();
        let accepted: Vec<_> = (0..PTY_INPUT_CAPACITY)
            .map(|n| input.enqueue(n.to_string()))
            .collect();
        let overflow = input.enqueue("SECRET_MUST_NOT_APPEAR".into());
        release_tx.send(()).unwrap();
        drop(input);
        worker.join().unwrap();
        assert!(accepted.iter().all(Result::is_ok));
        assert_eq!(
            overflow.unwrap_err(),
            "File d’écriture PTY saturée : entrée refusée, réessayez après vidage."
        );
        let mut expected = vec!["first".to_string(), "flush".to_string()];
        for n in 0..PTY_INPUT_CAPACITY {
            expected.extend([n.to_string(), "flush".into()]);
        }
        assert_eq!(*events.lock().unwrap(), expected);
    }

    #[test]
    fn kill_discards_queued_input_after_inflight_write_without_waiting_for_writer() {
        use super::start_pty_writer;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc, Mutex,
        };
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let events = Arc::new(Mutex::new(Vec::new()));
        let killed = Arc::new(AtomicBool::new(false));
        let (input, worker) = start_pty_writer(
            Box::new(RecordingWriter {
                events: Arc::clone(&events),
                gate: Some(BlockedWriter {
                    entered: entered_tx,
                    release: release_rx,
                }),
            }),
            Arc::clone(&killed),
        );
        input.enqueue("inflight".into()).unwrap();
        entered_rx.recv().unwrap();
        let queued = input.enqueue("must not be written".into());
        killed.store(true, Ordering::Relaxed);
        let after_kill = input.enqueue("must be refused immediately".into());
        release_tx.send(()).unwrap();
        worker.join().unwrap();
        assert!(
            after_kill.is_err(),
            "killed generation must reject admission even while its writer is blocked"
        );
        assert!(queued.is_ok());
        assert_eq!(*events.lock().unwrap(), ["inflight", "flush"]);
        assert!(input
            .enqueue("after kill".into())
            .unwrap_err()
            .contains("indisponible"));
    }

    #[test]
    fn oversized_input_is_rejected_before_queue_admission() {
        use super::{PtyInput, PTY_INPUT_MAX_BYTES};
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let result = PtyInput {
            sender,
            killed: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
        .enqueue("x".repeat(PTY_INPUT_MAX_BYTES + 1));
        assert_eq!(
            result.unwrap_err(),
            "Écriture PTY trop volumineuse : limite de 256 Kio par envoi."
        );
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn write_or_flush_failure_disconnects_queue_and_returns_nonsecret_error() {
        struct FailingWriter(bool);
        impl std::io::Write for FailingWriter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                if self.0 {
                    Err(std::io::Error::other("SECRET"))
                } else {
                    Ok(bytes.len())
                }
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Err(std::io::Error::other("SECRET"))
            }
        }
        for fail_write in [true, false] {
            let (input, worker) = super::start_pty_writer(
                Box::new(FailingWriter(fail_write)),
                std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            );
            input.enqueue("first".into()).unwrap();
            worker.join().unwrap();
            assert_eq!(
                input.enqueue("SECRET".into()).unwrap_err(),
                "Écriture PTY indisponible : session fermée ou erreur d’écriture."
            );
        }
    }

    // Gate either failure path so cancellation and queued input are deterministic.
    struct GatedFailingWriter {
        fail_write: bool,
        gate: Option<BlockedWriter>,
    }

    impl std::io::Write for GatedFailingWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self.fail_write {
                std::io::Write::write(self.gate.as_mut().unwrap(), bytes)?;
                Err(std::io::Error::other("SECRET_OS_ERROR"))
            } else {
                Ok(bytes.len())
            }
        }
        fn flush(&mut self) -> std::io::Result<()> {
            std::io::Write::write(self.gate.as_mut().unwrap(), b"")?;
            Err(std::io::Error::other("SECRET_OS_ERROR"))
        }
    }

    fn failure_callback_count(fail_write: bool, cancel: bool) -> usize {
        use std::sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            mpsc, Arc,
        };
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let killed = Arc::new(AtomicBool::new(false));
        let calls = Arc::new(AtomicUsize::new(0));
        let callback_calls = Arc::clone(&calls);
        let (input, worker) = super::start_pty_writer_with_failure(
            Box::new(GatedFailingWriter {
                fail_write,
                gate: Some(BlockedWriter {
                    entered: entered_tx,
                    release: release_rx,
                }),
            }),
            Arc::clone(&killed),
            move || {
                callback_calls.fetch_add(1, Ordering::Relaxed);
            },
        );
        input.enqueue("SECRET_INPUT".into()).unwrap();
        entered_rx.recv().unwrap();
        input.enqueue("queued and discarded".into()).unwrap();
        if cancel {
            killed.store(true, Ordering::Relaxed);
        }
        release_tx.send(()).unwrap();
        worker.join().unwrap();
        assert!(input.enqueue("after failure".into()).is_err());
        calls.load(Ordering::Relaxed)
    }

    #[test]
    fn input_error_payload_contains_only_session_and_generation() {
        for generation_id in [Some("generation-1".to_string()), None] {
            let payload = serde_json::to_value(super::PtyInputError {
                session_id: "fixture-session".into(),
                generation_id: generation_id.clone(),
            })
            .unwrap();
            assert_eq!(
                payload,
                serde_json::json!({
                    "session_id": "fixture-session", "generation_id": generation_id
                })
            );
        }
    }

    #[test]
    fn writer_failure_callback_reports_write_and_flush_failure_once() {
        for fail_write in [true, false] {
            assert_eq!(failure_callback_count(fail_write, false), 1);
        }
    }

    #[test]
    fn writer_failure_callback_is_suppressed_after_cancellation() {
        for fail_write in [true, false] {
            assert_eq!(failure_callback_count(fail_write, true), 0);
        }
    }

    #[test]
    fn conditional_kill_preserves_replacement_and_removes_only_matching_generation() {
        let mut sessions = HashMap::from([("s1".to_string(), Some("new".to_string()))]);
        assert!(
            remove_session_for_generation(&mut sessions, "s1", Some("old"), |s| s.as_deref())
                .is_none()
        );
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            remove_session_for_generation(&mut sessions, "s1", Some("new"), |s| s.as_deref()),
            Some(Some("new".to_string()))
        );
        assert!(sessions.is_empty());
    }

    #[test]
    fn unconditional_kill_supports_legacy_sessions_but_conditional_kill_does_not() {
        let mut sessions = HashMap::from([("s1".to_string(), None::<String>)]);
        assert!(
            remove_session_for_generation(&mut sessions, "s1", Some("old"), |s| s.as_deref())
                .is_none()
        );
        assert_eq!(
            remove_session_for_generation(&mut sessions, "s1", None, |s| s.as_deref()),
            Some(None)
        );
        assert!(
            remove_session_for_generation(&mut sessions, "s1", None, |s| s.as_deref()).is_none()
        );
    }

    #[test]
    fn process_exit_payload_is_structured_and_has_no_terminal_content() {
        let payload = serde_json::to_value(PtyExit {
            session_id: "fixture-session".into(),
            generation_id: Some("generation-1".into()),
            exit_code: Some(7),
        })
        .unwrap();
        assert_eq!(
            payload,
            serde_json::json!({"session_id":"fixture-session", "generation_id":"generation-1", "exit_code":7})
        );
    }

    #[test]
    fn ascii_only() {
        assert_eq!(incomplete_utf8_tail(b"hello"), 0);
    }
    #[test]
    fn empty_buffer() {
        assert_eq!(incomplete_utf8_tail(b""), 0);
    }
    #[test]
    fn complete_2byte_utf8() {
        assert_eq!(incomplete_utf8_tail(&[0xC3, 0xA9]), 0);
    }
    #[test]
    fn incomplete_2byte_utf8() {
        assert_eq!(incomplete_utf8_tail(&[0xC3]), 1);
    }
    #[test]
    fn complete_3byte_utf8() {
        assert_eq!(incomplete_utf8_tail(&[0xE2, 0x82, 0xAC]), 0);
    }
    #[test]
    fn incomplete_3byte_missing_1() {
        assert_eq!(incomplete_utf8_tail(&[0xE2, 0x82]), 2);
    }
    #[test]
    fn incomplete_3byte_missing_2() {
        assert_eq!(incomplete_utf8_tail(&[0xE2]), 1);
    }
    #[test]
    fn complete_4byte_utf8() {
        assert_eq!(incomplete_utf8_tail(&[0xF0, 0x9D, 0x84, 0x9E]), 0);
    }
    #[test]
    fn incomplete_4byte_missing_1() {
        assert_eq!(incomplete_utf8_tail(&[0xF0, 0x9D, 0x84]), 3);
    }
    #[test]
    fn incomplete_4byte_missing_2() {
        assert_eq!(incomplete_utf8_tail(&[0xF0, 0x9D]), 2);
    }
    #[test]
    fn incomplete_4byte_missing_3() {
        assert_eq!(incomplete_utf8_tail(&[0xF0]), 1);
    }
    #[test]
    fn ascii_after_complete_utf8() {
        assert_eq!(incomplete_utf8_tail(&[0xC3, 0xA9, b'a']), 0);
    }
    #[test]
    fn incomplete_at_end_of_ascii() {
        assert_eq!(incomplete_utf8_tail(&[b'a', b'b', 0xC3]), 1);
    }

    use super::home_dir;

    #[test]
    fn home_dir_returns_non_empty() {
        let home = home_dir();
        assert!(
            !home.is_empty(),
            "home_dir() should return a non-empty string"
        );
    }

    #[test]
    fn home_dir_falls_back_to_userprofile() {
        let original_home = std::env::var("HOME").ok();
        let original_profile = std::env::var("USERPROFILE").ok();
        unsafe { std::env::remove_var("HOME") };
        unsafe { std::env::set_var("USERPROFILE", "/test/fallback") };
        let result = home_dir();
        assert_eq!(result, "/test/fallback");
        if let Some(h) = original_home {
            unsafe { std::env::set_var("HOME", h) };
        }
        if let Some(p) = original_profile {
            unsafe { std::env::set_var("USERPROFILE", p) };
        } else {
            unsafe { std::env::remove_var("USERPROFILE") };
        }
    }

    #[test]
    fn single_continuation_byte() {
        assert_eq!(incomplete_utf8_tail(&[0x80]), 0);
    }
    #[test]
    fn single_continuation_byte_after_ascii() {
        assert_eq!(incomplete_utf8_tail(&[b'x', 0xBF]), 0);
    }
    #[test]
    fn four_byte_split_after_1() {
        assert_eq!(incomplete_utf8_tail(&[b'a', 0xF0]), 1);
    }
    #[test]
    fn four_byte_split_after_2() {
        assert_eq!(incomplete_utf8_tail(&[b'a', 0xF0, 0x9D]), 2);
    }
    #[test]
    fn four_byte_split_after_3() {
        assert_eq!(incomplete_utf8_tail(&[b'a', 0xF0, 0x9D, 0x84]), 3);
    }
    #[test]
    fn four_byte_complete_after_ascii() {
        assert_eq!(incomplete_utf8_tail(&[b'a', 0xF0, 0x9D, 0x84, 0x9E]), 0);
    }
    #[test]
    fn multiple_complete_then_incomplete() {
        let buf = &[0xC3, 0xA9, 0xC3, 0xA9, 0xE2, 0x82];
        assert_eq!(incomplete_utf8_tail(buf), 2);
    }
    #[test]
    fn three_continuation_bytes_only() {
        assert_eq!(incomplete_utf8_tail(&[0x80, 0x80, 0x80]), 0);
    }
}
