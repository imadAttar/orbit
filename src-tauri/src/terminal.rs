use crate::validation::{
    validate_dir, validate_filename, validate_path_within, validate_session_id,
};
use std::process::Command;

/// Decode a standard base64 string to bytes.
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (i, &b) in TABLE.iter().enumerate() {
        lookup[b as usize] = i as u8;
    }

    let input = input.trim_end_matches('=');
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let bytes = input.as_bytes();

    for chunk in bytes.chunks(4) {
        let mut buf = [0u8; 4];
        for (i, &b) in chunk.iter().enumerate() {
            buf[i] = lookup[b as usize];
            if buf[i] == 255 {
                return Err(format!("Caractere base64 invalide: {}", b as char));
            }
        }
        out.push((buf[0] << 2) | (buf[1] >> 4));
        if chunk.len() > 2 {
            out.push((buf[1] << 4) | (buf[2] >> 2));
        }
        if chunk.len() > 3 {
            out.push((buf[2] << 6) | buf[3]);
        }
    }
    Ok(out)
}

/// Open the user's preferred terminal emulator in the given directory.
#[tauri::command]
pub fn open_terminal(terminal: String, dir: String) -> Result<(), String> {
    validate_dir(&dir)?;
    match terminal.as_str() {
        // macOS
        "iterm2" => {
            Command::new("open")
                .args(["-a", "iTerm", &dir])
                .spawn()
                .map_err(|e| format!("Failed to open iTerm2: {e}"))?;
        }
        "ghostty" => {
            Command::new("ghostty")
                .arg(format!("--working-directory={dir}"))
                .spawn()
                .map_err(|e| format!("Failed to open Ghostty: {e}"))?;
        }
        // Windows
        "windows-terminal" => {
            Command::new("wt")
                .args(["-d", &dir])
                .spawn()
                .map_err(|e| format!("Failed to open Windows Terminal: {e}"))?;
        }
        "powershell" => {
            Command::new("powershell")
                .args([
                    "-NoExit",
                    "-Command",
                    &format!("Set-Location -LiteralPath '{}'", dir.replace('\'', "''")),
                ])
                .spawn()
                .map_err(|e| format!("Failed to open PowerShell: {e}"))?;
        }
        // Linux
        "gnome-terminal" => {
            Command::new("gnome-terminal")
                .args(["--working-directory", &dir])
                .spawn()
                .map_err(|e| format!("Failed to open GNOME Terminal: {e}"))?;
        }
        "konsole" => {
            Command::new("konsole")
                .args(["--workdir", &dir])
                .spawn()
                .map_err(|e| format!("Failed to open Konsole: {e}"))?;
        }
        _ => {
            #[cfg(target_os = "macos")]
            {
                Command::new("open")
                    .args(["-a", "Terminal", &dir])
                    .spawn()
                    .map_err(|e| format!("Failed to open Terminal: {e}"))?;
            }
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd")
                    .args(["/K", "cd", "/d", &dir])
                    .spawn()
                    .map_err(|e| format!("Failed to open CMD: {e}"))?;
            }
            #[cfg(target_os = "linux")]
            {
                // Pass dir as a separate argument to avoid shell injection
                Command::new("sh")
                    .args(["-c", "cd -- \"$1\" && exec \"$SHELL\"", "_", &dir])
                    .spawn()
                    .map_err(|e| format!("Failed to open shell: {e}"))?;
            }
        }
    }
    Ok(())
}

/// Open a file in the user's preferred editor.
#[tauri::command]
pub fn open_in_editor(
    editor: String,
    path: String,
    line: u32,
    project_dir: String,
) -> Result<(), String> {
    validate_dir(&project_dir)?;

    // Resolve and validate path stays within project (prevents path traversal)
    let full_path = validate_path_within(&project_dir, &path)?;

    let line_str = line.to_string();
    match editor.as_str() {
        "vscode" => {
            Command::new("code")
                .args(["--goto", &format!("{full_path}:{line_str}")])
                .spawn()
                .map_err(|e| format!("Failed to open VS Code: {e}"))?;
        }
        "cursor" => {
            Command::new("cursor")
                .args(["--goto", &format!("{full_path}:{line_str}")])
                .spawn()
                .map_err(|e| format!("Failed to open Cursor: {e}"))?;
        }
        "zed" => {
            let arg = if line > 0 {
                format!("{full_path}:{line_str}")
            } else {
                full_path.clone()
            };
            Command::new("zed")
                .arg(&arg)
                .spawn()
                .map_err(|e| format!("Failed to open Zed: {e}"))?;
        }
        "intellij" | "webstorm" | "goland" | "pycharm" => {
            // JetBrains IDEs use the same CLI pattern
            let bin = match editor.as_str() {
                "intellij" => "idea",
                "webstorm" => "webstorm",
                "goland" => "goland",
                "pycharm" => "pycharm",
                _ => "idea",
            };
            let mut args = vec!["--line", &line_str, &full_path];
            if line == 0 {
                args = vec![&full_path];
            }
            Command::new(bin)
                .args(&args)
                .spawn()
                .map_err(|e| format!("Failed to open {editor}: {e}"))?;
        }
        "sublime" => {
            let arg = if line > 0 {
                format!("{full_path}:{line_str}")
            } else {
                full_path.clone()
            };
            Command::new("subl")
                .arg(&arg)
                .spawn()
                .map_err(|e| format!("Failed to open Sublime Text: {e}"))?;
        }
        "nvim" => {
            // Open in the user's terminal emulator — avoid shell/AppleScript interpolation
            #[cfg(target_os = "macos")]
            {
                // Use a temporary script to avoid AppleScript injection entirely
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();
                let tmp = std::env::temp_dir().join(format!(
                    "orbit-nvim-{}-{}.sh",
                    std::process::id(),
                    ts
                ));
                let mut args_line = String::from("exec nvim");
                if line > 0 {
                    args_line.push_str(&format!(" +{line_str}"));
                }
                args_line.push_str(" \"$1\"");
                let script = format!("#!/bin/sh\n{args_line}\n");
                std::fs::write(&tmp, &script)
                    .map_err(|e| format!("Failed to write temp script: {e}"))?;
                std::fs::set_permissions(&tmp, std::os::unix::fs::PermissionsExt::from_mode(0o755))
                    .map_err(|e| format!("Failed to set permissions: {e}"))?;
                let tmp_str = tmp
                    .to_str()
                    .ok_or_else(|| "Temp script path is not valid UTF-8".to_string())?;
                Command::new("open")
                    .args(["-a", "Terminal", tmp_str, "--args", &full_path])
                    .spawn()
                    .map_err(|e| format!("Failed to open Neovim: {e}"))?;
                // Clean up temp script after spawn (process has forked)
                let _ = std::fs::remove_file(&tmp);
            }
            #[cfg(target_os = "linux")]
            {
                let mut args = vec!["-e", "nvim"];
                let line_arg;
                if line > 0 {
                    line_arg = format!("+{line_str}");
                    args.push(&line_arg);
                }
                args.push(&full_path);
                Command::new("x-terminal-emulator")
                    .args(&args)
                    .spawn()
                    .or_else(|_| Command::new("xterm").args(&args).spawn())
                    .map_err(|e| format!("Failed to open Neovim: {e}"))?;
            }
            #[cfg(target_os = "windows")]
            {
                let mut args = vec!["/C", "start", "nvim"];
                let line_arg;
                if line > 0 {
                    line_arg = format!("+{line_str}");
                    args.push(&line_arg);
                }
                args.push(&full_path);
                Command::new("cmd")
                    .args(&args)
                    .spawn()
                    .map_err(|e| format!("Failed to open Neovim: {e}"))?;
            }
        }
        "emacs" => {
            let line_arg = if line > 0 {
                format!("+{line_str}")
            } else {
                String::new()
            };
            let mut args: Vec<&str> = Vec::new();
            if line > 0 {
                args.push(&line_arg);
            }
            args.push(&full_path);
            Command::new("emacs")
                .args(&args)
                .spawn()
                .or_else(|_| {
                    let mut ec_args = vec!["-n"];
                    if line > 0 {
                        ec_args.push(&line_arg);
                    }
                    ec_args.push(&full_path);
                    Command::new("emacsclient").args(&ec_args).spawn()
                })
                .map_err(|e| format!("Failed to open Emacs: {e}"))?;
        }
        _ => {
            // Default: try xdg-open / open
            #[cfg(target_os = "macos")]
            {
                Command::new("open")
                    .arg(&full_path)
                    .spawn()
                    .map_err(|e| format!("Failed to open file: {e}"))?;
            }
            #[cfg(target_os = "linux")]
            {
                Command::new("xdg-open")
                    .arg(&full_path)
                    .spawn()
                    .map_err(|e| format!("Failed to open file: {e}"))?;
            }
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd")
                    .args(["/C", "start", "", &full_path])
                    .spawn()
                    .map_err(|e| format!("Failed to open file: {e}"))?;
            }
        }
    }
    Ok(())
}

/// Max scrollback size: 1 MB
const MAX_SCROLLBACK_BYTES: usize = 1_048_576;

/// Save scrollback data for a session (capped at 1 MB).
#[tauri::command]
pub fn save_scrollback(session_id: String, data: String) -> Result<(), String> {
    validate_session_id(&session_id)?;
    let home = super::pty::home_dir();
    let dir = std::path::Path::new(&home)
        .join(".claude-ide")
        .join("scrollback");
    std::fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "Failed to create scrollback directory {}: {e}",
            dir.display()
        )
    })?;
    let path = dir.join(format!("{session_id}.txt"));
    // Truncate to last MAX_SCROLLBACK_BYTES to avoid filling disk
    let truncated = if data.len() > MAX_SCROLLBACK_BYTES {
        // Find a char boundary near the cut point
        let start = data.len() - MAX_SCROLLBACK_BYTES;
        let safe_start = data.ceil_char_boundary(start);
        &data[safe_start..]
    } else {
        &data
    };
    std::fs::write(&path, truncated).map_err(|e| format!("Failed to save scrollback: {e}"))
}

/// Load scrollback data for a session.
#[tauri::command]
pub fn load_scrollback(session_id: String) -> Result<Option<String>, String> {
    validate_session_id(&session_id)?;
    let home = super::pty::home_dir();
    let path = std::path::Path::new(&home)
        .join(".claude-ide")
        .join("scrollback")
        .join(format!("{session_id}.txt"));
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to load scrollback: {e}"))
}

/// Send a desktop notification when Claude finishes.
#[tauri::command]
pub fn notify_done(session_name: String) -> Result<(), String> {
    // Use osascript with separate -e args to avoid injection — pass title as env var
    #[cfg(target_os = "macos")]
    {
        // Strip any control characters from session name
        let safe_title: String = session_name
            .chars()
            .filter(|c| !c.is_control())
            .take(100)
            .collect();
        Command::new("osascript")
            .args([
                "-e",
                "on run argv",
                "-e",
                "display notification \"Claude a terminé\" with title (item 1 of argv) sound name \"Glass\"",
                "-e",
                "end run",
                &safe_title,
            ])
            .spawn()
            .map_err(|e| format!("Notification error: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        // notify-send takes separate args — no shell interpolation
        Command::new("notify-send")
            .args([&session_name, "Claude a terminé"])
            .spawn()
            .map_err(|e| format!("Notification error: {e}"))?;
    }

    // Sanitize for PowerShell (escape ' as '')
    #[cfg(target_os = "windows")]
    {
        // Pass title as a parameter to avoid PowerShell injection
        let safe_title: String = session_name
            .chars()
            .filter(|c| !c.is_control())
            .take(100)
            .collect();
        Command::new("powershell")
            .args([
                "-Command",
                "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); \
                 $n = New-Object System.Windows.Forms.NotifyIcon; \
                 $n.Icon = [System.Drawing.SystemIcons]::Information; \
                 $n.Visible = $true; \
                 $n.ShowBalloonTip(3000, $args[0], 'Claude a terminé', 'Info')",
                "-args",
                &safe_title,
            ])
            .spawn()
            .map_err(|e| format!("Notification error: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn save_temp_image(data: String, extension: String) -> Result<String, String> {
    // Validate extension
    let ext = match extension.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" => extension.as_str(),
        _ => "png",
    };
    let home = super::pty::home_dir();
    let dir = std::path::Path::new(&home)
        .join(".orbit")
        .join("tmp-images");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Impossible de creer le repertoire temp: {e}"))?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    // Use nanosecond precision + process id for uniqueness
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    let pid = std::process::id();
    let filename = format!("paste-{ts}-{pid}-{nanos}.{ext}");
    let path = dir.join(&filename);
    let bytes = base64_decode(&data)?;
    std::fs::write(&path, &bytes).map_err(|e| format!("Impossible d'ecrire l'image: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    let target = std::path::Path::new(&path);

    // Block path traversal components
    for component in target.components() {
        if let std::path::Component::ParentDir = component {
            return Err("Chemin invalide : les composants '..' ne sont pas autorises".to_string());
        }
    }

    // Restrict to user home directory (canonicalize for symlink safety)
    let home = super::pty::home_dir();
    if !home.is_empty() {
        let home_canonical = std::path::Path::new(&home)
            .canonicalize()
            .unwrap_or_else(|_| std::path::PathBuf::from(&home));
        // For non-existent paths, check the closest existing ancestor
        let mut check_path = target.to_path_buf();
        while !check_path.exists() {
            if let Some(parent) = check_path.parent() {
                check_path = parent.to_path_buf();
            } else {
                break;
            }
        }
        if let Ok(canonical) = check_path.canonicalize() {
            if !canonical.starts_with(&home_canonical) {
                return Err(format!("Acces refuse : le chemin doit etre sous {home}"));
            }
        }
    }

    if target.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(target).map_err(|e| format!("Impossible de creer le repertoire: {e}"))
}

/// Max file read size: 1 MB
const MAX_READ_BYTES: u64 = 1_048_576;

/// Read a file from ~/.orbit/ by name. Used for hook-based session state detection.
/// Capped at 1 MB to prevent OOM on unexpectedly large files.
#[tauri::command]
pub fn read_orbit_file(name: String) -> Result<String, String> {
    validate_filename(&name)?;
    let home = super::pty::home_dir();
    let path = std::path::Path::new(&home).join(".orbit").join(&name);
    // Check file size before reading
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Impossible de lire {} : {e}", path.display()))?;
    if metadata.len() > MAX_READ_BYTES {
        return Err(format!(
            "Fichier trop volumineux ({} octets, max {} octets)",
            metadata.len(),
            MAX_READ_BYTES
        ));
    }
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Impossible de lire {} : {e}", path.display()))
}

/// Write a file to ~/.orbit/ by name. Used for persisting store data via Rust.
#[tauri::command]
pub fn write_orbit_file(name: String, data: String) -> Result<(), String> {
    validate_filename(&name)?;
    let home = super::pty::home_dir();
    let dir = std::path::Path::new(&home).join(".orbit");
    write_orbit_file_in(&dir, &name, |file| {
        use std::io::Write;
        file.write_all(data.as_bytes())
    })
}

// Explicit directory and write operation keep failure tests away from the user's home.
fn write_orbit_file_in(
    dir: &std::path::Path,
    name: &str,
    write: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> Result<(), String> {
    validate_filename(name)?;
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Impossible de creer le repertoire {} : {e}", dir.display()))?;
    let path = dir.join(name);
    static NEXT_TEMP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let (temp_path, mut file) = loop {
        let nonce = NEXT_TEMP.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let temp_path = dir.join(format!(".orbit-save-{}-{nonce}.tmp", std::process::id()));
        // Even a caller-supplied name matching our temporary naming scheme must
        // never be opened as the staging file.
        if temp_path == path {
            continue;
        }
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => break (temp_path, file),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Impossible de creer {} : {e}", temp_path.display())),
        }
    };

    let prepared = write(&mut file).and_then(|()| file.sync_all());
    // Close before publication/cleanup, including on Windows.
    drop(file);
    // std::fs::rename replaces an existing file on Unix AND Windows. Never unlink
    // the destination first: readers must see either the old or the complete new file.
    let result = prepared.and_then(|()| std::fs::rename(&temp_path, &path));
    if let Err(e) = result {
        let cleanup = match std::fs::remove_file(&temp_path) {
            Ok(()) => String::new(),
            Err(cleanup) if cleanup.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(cleanup) => format!(
                " ; nettoyage de {} impossible : {cleanup}",
                temp_path.display()
            ),
        };
        return Err(format!(
            "Impossible d'ecrire {} : {e}{cleanup}",
            path.display()
        ));
    }
    Ok(())
}

/// Collect recent logs and system info for crash reporting.
/// Returns a pre-formatted report string safe to include in a GitHub issue.
#[tauri::command]
pub fn collect_crash_report(error_message: String) -> Result<String, String> {
    let home = super::pty::home_dir();
    let log_path = std::path::Path::new(&home)
        .join(".orbit")
        .join("logs")
        .join("orbit.log");

    // Sanitize error message
    let safe_error: String = error_message
        .chars()
        .filter(|c| !c.is_control())
        .take(500)
        .collect();

    // Read last 64KB of log file, then take last 100 lines
    let recent_logs = if let Ok(file) = std::fs::File::open(&log_path) {
        use std::io::{Read, Seek, SeekFrom};
        let mut file = file;
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let max_read: u64 = 65_536;
        if len > max_read {
            let _ = file.seek(SeekFrom::End(-(max_read as i64)));
        }
        let mut buf = String::new();
        let _ = file.read_to_string(&mut buf);
        let lines: Vec<&str> = buf.lines().collect();
        let start = if lines.len() > 100 {
            lines.len() - 100
        } else {
            0
        };
        lines[start..].join("\n")
    } else {
        "(logs unavailable)".to_string()
    };

    let report = format!(
        "## Crash Report\n\n\
         **Error:** `{}`\n\
         **OS:** {} {}\n\
         **Arch:** {}\n\
         **App version:** {}\n\n\
         <details>\n<summary>Recent logs (last 100 lines)</summary>\n\n\
         ```\n{}\n```\n\n\
         </details>",
        safe_error,
        std::env::consts::OS,
        std::env::consts::FAMILY,
        std::env::consts::ARCH,
        env!("CARGO_PKG_VERSION"),
        recent_logs,
    );

    Ok(report)
}

/// Log a message from the frontend. PRIVACY: never log prompt content or user input.
#[tauri::command]
pub fn log_frontend(level: String, target: String, message: String) {
    match level.as_str() {
        "error" => tracing::error!(target = %target, "{message}"),
        "warn" => tracing::warn!(target = %target, "{message}"),
        "info" => tracing::info!(target = %target, "{message}"),
        _ => tracing::debug!(target = %target, "{message}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty;

    // --- base64_decode ---

    #[test]
    fn base64_decode_valid_string() {
        let result = base64_decode("SGVsbG8=").unwrap();
        assert_eq!(result, b"Hello");
    }

    #[test]
    fn base64_decode_empty_string() {
        let result = base64_decode("").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn base64_decode_no_padding() {
        let result = base64_decode("YQ").unwrap();
        assert_eq!(result, b"a");
    }

    #[test]
    fn base64_decode_rejects_invalid_chars() {
        let result = base64_decode("!!!!");
        assert!(result.is_err());
    }

    // Validation tests are in validation.rs

    // --- save_scrollback / load_scrollback ---

    #[test]
    fn scrollback_roundtrip() {
        let sid = format!("test-scrollback-{}", std::process::id());
        let data = "Hello scrollback\nLine 2".to_string();

        let save_result = save_scrollback(sid.clone(), data.clone());
        assert!(save_result.is_ok(), "save failed: {:?}", save_result);

        let load_result = load_scrollback(sid.clone());
        assert!(load_result.is_ok());
        assert_eq!(load_result.unwrap(), Some(data));

        // Cleanup
        let home = pty::home_dir();
        let path = std::path::Path::new(&home)
            .join(".claude-ide")
            .join("scrollback")
            .join(format!("{sid}.txt"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn load_scrollback_returns_none_for_missing() {
        let result = load_scrollback("nonexistent-session-xyz".to_string());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), None);
    }

    #[test]
    fn save_scrollback_rejects_invalid_session_id() {
        let result = save_scrollback("../etc/passwd".to_string(), "data".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn save_scrollback_truncates_large_data() {
        let sid = format!("test-large-{}", std::process::id());
        let data = "x".repeat(MAX_SCROLLBACK_BYTES + 1000);

        let result = save_scrollback(sid.clone(), data);
        assert!(result.is_ok());

        let loaded = load_scrollback(sid.clone()).unwrap().unwrap();
        assert!(loaded.len() <= MAX_SCROLLBACK_BYTES);

        // Cleanup
        let home = pty::home_dir();
        let path = std::path::Path::new(&home)
            .join(".claude-ide")
            .join("scrollback")
            .join(format!("{sid}.txt"));
        let _ = std::fs::remove_file(path);
    }

    // --- read_orbit_file / write_orbit_file ---

    struct OrbitTestDir(std::path::PathBuf);

    impl OrbitTestDir {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            loop {
                let path = std::env::temp_dir().join(format!(
                    "orbit-atomic-test-{}-{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos(),
                    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
                ));
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(e) => panic!("create test directory: {e}"),
                }
            }
        }
    }

    impl Drop for OrbitTestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn orbit_atomic_partial_write_failure_preserves_old_json() {
        use std::io::Write;
        let dir = OrbitTestDir::new();
        let path = dir.0.join("store.json");
        let old = r#"{"version":"old","complete":true}"#;
        std::fs::write(&path, old).unwrap();

        let result = write_orbit_file_in(&dir.0, "store.json", |file| {
            file.write_all(b"{\"version\":")?;
            Err(std::io::Error::other("injected disk write failure"))
        });

        assert!(result.unwrap_err().contains("injected disk write failure"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), old);
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn orbit_atomic_replaces_complete_json_and_cleans_temp() {
        use std::io::Write;
        let dir = OrbitTestDir::new();
        let nested = dir.0.join("new").join("orbit");
        let old = r#"{"version":"old","extra":"must disappear"}"#;
        let new = r#"{"version":"new"}"#;
        write_orbit_file_in(&nested, "store.json", |f| f.write_all(old.as_bytes())).unwrap();
        write_orbit_file_in(&nested, "store.json", |f| f.write_all(new.as_bytes())).unwrap();
        let actual = std::fs::read_to_string(nested.join("store.json")).unwrap();
        assert_eq!(actual, new);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&actual).unwrap()["version"],
            "new"
        );
        assert_eq!(std::fs::read_dir(&nested).unwrap().count(), 1);
    }

    #[test]
    fn orbit_atomic_publication_failure_cleans_temp_and_preserves_destination() {
        use std::io::Write;
        let dir = OrbitTestDir::new();
        // A non-empty directory cannot be replaced by a file on Unix or Windows.
        let destination = dir.0.join("store.json");
        std::fs::create_dir(&destination).unwrap();
        let old = r#"{"version":"old"}"#;
        std::fs::write(destination.join("old.json"), old).unwrap();
        let result = write_orbit_file_in(&dir.0, "store.json", |f| f.write_all(b"{}"));
        assert!(result.unwrap_err().contains("Impossible d'ecrire"));
        assert_eq!(
            std::fs::read_to_string(destination.join("old.json")).unwrap(),
            old
        );
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn orbit_atomic_failed_rename_preserves_existing_json_file() {
        use std::io::Write;
        let dir = OrbitTestDir::new();
        let path = dir.0.join("store.json");
        let old = r#"{"version":"old"}"#;
        std::fs::write(&path, old).unwrap();
        let result = write_orbit_file_in(&dir.0, "store.json", |file| {
            file.write_all(b"{\"version\":\"new\"}")?;
            // Simulate losing the staging entry just before publication. The open
            // handle can still sync, but rename must fail (no permission assumptions).
            let temp = std::fs::read_dir(&dir.0)?
                .map(|entry| entry.map(|entry| entry.path()))
                .collect::<std::io::Result<Vec<_>>>()?
                .into_iter()
                .find(|entry| entry != &path)
                .unwrap();
            std::fs::remove_file(temp)
        });
        assert!(result.unwrap_err().contains("Impossible d'ecrire"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), old);
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn orbit_atomic_mkdir_failure_is_reported_before_writing() {
        let dir = OrbitTestDir::new();
        let blocked = dir.0.join("not-a-directory");
        std::fs::write(&blocked, b"unchanged").unwrap();
        let result = write_orbit_file_in(&blocked, "store.json", |_| {
            panic!("must not write after mkdir failure")
        });
        assert!(result
            .unwrap_err()
            .contains("Impossible de creer le repertoire"));
        assert_eq!(std::fs::read(&blocked).unwrap(), b"unchanged");
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn orbit_atomic_validates_filename_before_filesystem_changes() {
        let dir = OrbitTestDir::new();
        let missing = dir.0.join("must-not-be-created");
        for name in ["../outside.json", "foo/bar.json", r"foo\bar.json"] {
            assert!(write_orbit_file_in(&missing, name, |_| {
                panic!("invalid filename must not reach write")
            })
            .is_err());
        }
        assert!(!missing.exists());
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 0);
    }

    #[test]
    fn orbit_atomic_concurrent_writers_and_reader_never_observe_partial_json() {
        use std::io::Write;
        let dir = OrbitTestDir::new();
        let path = dir.0.join("store.json");
        let old = r#"{"version":"old"}"#;
        let new = r#"{"version":"new"}"#;
        std::fs::write(&path, old).unwrap();
        let prepared = std::sync::Barrier::new(5);
        let observed = std::sync::Barrier::new(5);
        std::thread::scope(|scope| {
            for _ in 0..4 {
                let prepared = &prepared;
                let observed = &observed;
                let dir = &dir.0;
                scope.spawn(move || {
                    write_orbit_file_in(dir, "store.json", |f| {
                        f.write_all(b"{\"version\":")?;
                        prepared.wait();
                        observed.wait();
                        f.write_all(b"\"new\"}")
                    })
                    .unwrap();
                });
            }
            prepared.wait();
            // All four writers hold distinct, partially written temp files.
            let snapshot = std::fs::read_to_string(&path).unwrap();
            let entries = std::fs::read_dir(&dir.0).unwrap().count();
            observed.wait();
            assert_eq!(snapshot, old);
            assert_eq!(entries, 5);
            for _ in 0..256 {
                let snapshot = std::fs::read_to_string(&path).unwrap();
                assert!(
                    snapshot == old || snapshot == new,
                    "partial JSON: {snapshot}"
                );
            }
        });
        assert_eq!(std::fs::read_to_string(&path).unwrap(), new);
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn read_orbit_file_rejects_path_traversal() {
        assert!(read_orbit_file("../etc/passwd".to_string()).is_err());
        assert!(read_orbit_file("foo/bar.txt".to_string()).is_err());
        assert!(read_orbit_file("foo\\bar.txt".to_string()).is_err());
    }

    #[test]
    fn write_orbit_file_rejects_path_traversal() {
        assert!(write_orbit_file("../etc/passwd".to_string(), "x".to_string()).is_err());
        assert!(write_orbit_file("foo/bar.txt".to_string(), "x".to_string()).is_err());
    }

    #[test]
    fn read_orbit_file_returns_error_for_missing() {
        let result = read_orbit_file("nonexistent-file-xyz.txt".to_string());
        assert!(result.is_err());
    }

    // --- create_directory ---

    #[test]
    fn create_directory_rejects_parent_dir_component() {
        let result = create_directory("/tmp/../etc/hacked".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains(".."));
    }

    #[test]
    fn create_directory_allows_valid_path_under_home() {
        let home = pty::home_dir();
        let path = format!("{home}/.orbit/test-create-dir-{}", std::process::id());
        let result = create_directory(path.clone());
        assert!(result.is_ok());
        assert!(std::path::Path::new(&path).is_dir());
        let _ = std::fs::remove_dir(&path);
    }

    // --- save_temp_image ---

    #[test]
    fn save_temp_image_validates_extension() {
        // Valid base64 for a single pixel
        let result = save_temp_image("AAAA".to_string(), "png".to_string());
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.ends_with(".png"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_temp_image_defaults_unknown_extension() {
        let result = save_temp_image("AAAA".to_string(), "exe".to_string());
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.ends_with(".png")); // defaults to png
        let _ = std::fs::remove_file(&path);
    }
}
