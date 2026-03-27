use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    killed: Arc<AtomicBool>,
}

pub struct PtyState {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PtyOutput {
    session_id: String,
    data: String,
}

/// Get the user home directory cross-platform.
pub fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default()
}

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
) -> Result<(), String> {
    tracing::info!(session_id = %session_id, project_dir = %project_dir, cols, rows, shell_only = shell_only.unwrap_or(false), "Spawning PTY");
    if !std::path::Path::new(&project_dir).is_dir() {
        return Err(format!("Repertoire projet introuvable : {project_dir}"));
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
            if cfg!(target_os = "windows") { "cmd.exe".to_string() } else { "/bin/sh".to_string() }
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
        "HOME", "USERPROFILE", "USER", "USERNAME", "LOGNAME",
        "PATH", "SHELL", "TERM", "LANG", "LC_ALL", "LC_CTYPE",
        "EDITOR", "VISUAL", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
        "ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR",
        "TMPDIR", "TMP", "TEMP",
        "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
        "SSH_AUTH_SOCK", "SSH_AGENT_PID",
        "DISPLAY", "WAYLAND_DISPLAY",
        "COLORTERM", "TERM_PROGRAM",
    ];
    for (key, value) in std::env::vars() {
        if allowed_vars.contains(&key.as_str()) || key.starts_with("CLAUDE_") || key.starts_with("NVM_") || key.starts_with("FNM_") {
            cmd.env(key, value);
        }
    }

    let path_env = std::env::var("PATH").unwrap_or_default();
    let home = home_dir();

    #[cfg(not(target_os = "windows"))]
    let (extra_paths, separator): (Vec<String>, &str) = (vec![
        format!("{home}/.local/bin"),
        format!("{home}/.npm-global/bin"),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
    ], ":");

    #[cfg(target_os = "windows")]
    let (extra_paths, separator): (Vec<String>, &str) = (vec![
        format!("{home}\\AppData\\Roaming\\npm"),
        "C:\\Program Files\\nodejs".into(),
    ], ";");

    let full_path = std::iter::once(&path_env)
        .chain(extra_paths.iter().filter(|p| !path_env.contains(p.as_str())))
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

    {
        let mut sessions = state
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        sessions.insert(
            session_id.clone(),
            PtySession {
                master: pair.master,
                writer,
                child,
                killed,
            },
        );
    }

    let sid = session_id.clone();
    let app_clone = app.clone();
    let sessions_arc = Arc::clone(&state.sessions);
    thread::spawn(move || {
        read_pty_output(reader, sid, app_clone, sessions_arc, killed_clone);
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
) {
    let mut buf = [0u8; 4096];
    let mut leftover = Vec::new();
    loop {
        if killed.load(Ordering::Relaxed) {
            tracing::info!(session_id = %session_id, "Reader stopping: kill flag set");
            break;
        }
        let offset = leftover.len();
        debug_assert!(offset <= 3, "leftover should be at most 3 bytes from incomplete UTF-8");
        if offset > 0 && offset < buf.len() {
            buf[..offset].copy_from_slice(&leftover);
            leftover.clear();
        } else if offset >= buf.len() {
            leftover.clear();
        }
        match reader.read(&mut buf[offset..]) {
            Ok(0) => break,
            Ok(n) => {
                let total = offset + n;
                let tail = incomplete_utf8_tail(&buf[..total]);
                let valid_end = total - tail;
                if tail > 0 {
                    leftover.extend_from_slice(&buf[valid_end..total]);
                }
                let data = String::from_utf8_lossy(&buf[..valid_end]).to_string();
                if !data.is_empty() {
                    let _ = app.emit(
                        "pty-output",
                        PtyOutput {
                            session_id: session_id.clone(),
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
                data: "\r\n\x1b[33m[Session terminee — cree une nouvelle session pour continuer]\x1b[0m\r\n"
                    .to_string(),
            },
        );
    }
    // Only clean up if not already removed by kill_pty
    if !killed.load(Ordering::Relaxed) {
        let mut map = sessions.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&session_id);
    }
}

#[tauri::command]
pub fn write_pty(
    state: State<'_, PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let session = sessions.get_mut(&session_id)
        .ok_or_else(|| format!("Session {session_id} not found (process may have exited)"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write error: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Flush error: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn resize_pty(
    state: State<'_, PtyState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let session = sessions.get(&session_id)
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

#[tauri::command]
pub fn kill_pty(state: State<'_, PtyState>, session_id: String) -> Result<(), String> {
    tracing::info!(session_id = %session_id, "Killing PTY");
    let mut sessions = state
        .sessions
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(mut session) = sessions.remove(&session_id) {
        // Signal reader thread to stop before killing the child
        session.killed.store(true, Ordering::Relaxed);
        if let Err(e) = session.child.kill() {
            tracing::warn!(session_id = %session_id, "Failed to kill PTY child: {e}");
        }
        if let Err(e) = session.child.wait() {
            tracing::warn!(session_id = %session_id, "Failed to wait on PTY child: {e}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::incomplete_utf8_tail;

    #[test]
    fn ascii_only() { assert_eq!(incomplete_utf8_tail(b"hello"), 0); }
    #[test]
    fn empty_buffer() { assert_eq!(incomplete_utf8_tail(b""), 0); }
    #[test]
    fn complete_2byte_utf8() { assert_eq!(incomplete_utf8_tail(&[0xC3, 0xA9]), 0); }
    #[test]
    fn incomplete_2byte_utf8() { assert_eq!(incomplete_utf8_tail(&[0xC3]), 1); }
    #[test]
    fn complete_3byte_utf8() { assert_eq!(incomplete_utf8_tail(&[0xE2, 0x82, 0xAC]), 0); }
    #[test]
    fn incomplete_3byte_missing_1() { assert_eq!(incomplete_utf8_tail(&[0xE2, 0x82]), 2); }
    #[test]
    fn incomplete_3byte_missing_2() { assert_eq!(incomplete_utf8_tail(&[0xE2]), 1); }
    #[test]
    fn complete_4byte_utf8() { assert_eq!(incomplete_utf8_tail(&[0xF0, 0x9D, 0x84, 0x9E]), 0); }
    #[test]
    fn incomplete_4byte_missing_1() { assert_eq!(incomplete_utf8_tail(&[0xF0, 0x9D, 0x84]), 3); }
    #[test]
    fn incomplete_4byte_missing_2() { assert_eq!(incomplete_utf8_tail(&[0xF0, 0x9D]), 2); }
    #[test]
    fn incomplete_4byte_missing_3() { assert_eq!(incomplete_utf8_tail(&[0xF0]), 1); }
    #[test]
    fn ascii_after_complete_utf8() { assert_eq!(incomplete_utf8_tail(&[0xC3, 0xA9, b'a']), 0); }
    #[test]
    fn incomplete_at_end_of_ascii() { assert_eq!(incomplete_utf8_tail(&[b'a', b'b', 0xC3]), 1); }

    use super::home_dir;

    #[test]
    fn home_dir_returns_non_empty() {
        let home = home_dir();
        assert!(!home.is_empty(), "home_dir() should return a non-empty string");
    }

    #[test]
    fn home_dir_falls_back_to_userprofile() {
        let original_home = std::env::var("HOME").ok();
        let original_profile = std::env::var("USERPROFILE").ok();
        unsafe { std::env::remove_var("HOME") };
        unsafe { std::env::set_var("USERPROFILE", "/test/fallback") };
        let result = home_dir();
        assert_eq!(result, "/test/fallback");
        if let Some(h) = original_home { unsafe { std::env::set_var("HOME", h) }; }
        if let Some(p) = original_profile { unsafe { std::env::set_var("USERPROFILE", p) }; }
        else { unsafe { std::env::remove_var("USERPROFILE") }; }
    }

    #[test]
    fn single_continuation_byte() { assert_eq!(incomplete_utf8_tail(&[0x80]), 0); }
    #[test]
    fn single_continuation_byte_after_ascii() { assert_eq!(incomplete_utf8_tail(&[b'x', 0xBF]), 0); }
    #[test]
    fn four_byte_split_after_1() { assert_eq!(incomplete_utf8_tail(&[b'a', 0xF0]), 1); }
    #[test]
    fn four_byte_split_after_2() { assert_eq!(incomplete_utf8_tail(&[b'a', 0xF0, 0x9D]), 2); }
    #[test]
    fn four_byte_split_after_3() { assert_eq!(incomplete_utf8_tail(&[b'a', 0xF0, 0x9D, 0x84]), 3); }
    #[test]
    fn four_byte_complete_after_ascii() { assert_eq!(incomplete_utf8_tail(&[b'a', 0xF0, 0x9D, 0x84, 0x9E]), 0); }
    #[test]
    fn multiple_complete_then_incomplete() {
        let buf = &[0xC3, 0xA9, 0xC3, 0xA9, 0xE2, 0x82];
        assert_eq!(incomplete_utf8_tail(buf), 2);
    }
    #[test]
    fn three_continuation_bytes_only() { assert_eq!(incomplete_utf8_tail(&[0x80, 0x80, 0x80]), 0); }
}
