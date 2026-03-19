use crate::pty::home_dir;
use std::sync::OnceLock;

/// Cached claude binary path — resolved once, reused across all PTY spawns.
static CLAUDE_PATH: OnceLock<Option<String>> = OnceLock::new();

/// Resolve the full path to the `claude` binary.
/// Desktop apps launched from Finder/Explorer have a minimal PATH.
pub(crate) fn resolve_claude_path() -> Option<String> {
    CLAUDE_PATH.get_or_init(resolve_claude_path_inner).clone()
}

fn resolve_claude_path_inner() -> Option<String> {
    let home = home_dir();

    #[cfg(not(target_os = "windows"))]
    let candidates: Vec<String> = vec![
        format!("{home}/.local/bin/claude"),
        format!("{home}/.npm-global/bin/claude"),
        "/opt/homebrew/bin/claude".into(),
        "/usr/local/bin/claude".into(),
    ];

    #[cfg(target_os = "windows")]
    let candidates: Vec<String> = vec![
        format!("{home}\\.local\\bin\\claude.exe"),
        format!("{home}\\AppData\\Roaming\\npm\\claude.cmd"),
        format!("{home}\\AppData\\Roaming\\npm\\claude.exe"),
        "C:\\Program Files\\nodejs\\claude.cmd".into(),
    ];

    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Some(path.clone());
        }
    }
    // Fallback: try PATH lookup
    #[cfg(not(target_os = "windows"))]
    let lookup = std::process::Command::new("which").arg("claude").output();
    #[cfg(target_os = "windows")]
    let lookup = std::process::Command::new("where").arg("claude").output();

    lookup.ok().and_then(|o| {
        if o.status.success() {
            String::from_utf8(o.stdout)
                .ok()
                .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
        } else {
            None
        }
    })
}

#[tauri::command]
pub fn check_claude_installed() -> bool {
    resolve_claude_path().is_some()
}

#[tauri::command]
pub fn install_claude() -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    let npm = "npm";
    #[cfg(target_os = "windows")]
    let npm = "npm.cmd";

    let output = std::process::Command::new(npm)
        .args(["install", "-g", "@anthropic-ai/claude-code"])
        .output()
        .map_err(|e| format!("npm non trouve. Installez Node.js d'abord : {e}"))?;

    if output.status.success() {
        if let Some(path) = resolve_claude_path() {
            Ok(format!("Claude Code installe : {path}"))
        } else {
            Ok("Claude Code installe. Redemarrez l'application.".into())
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Echec de l'installation : {stderr}"))
    }
}

#[tauri::command]
pub async fn improve_prompt(prompt: String) -> Result<String, String> {
    let claude_bin = resolve_claude_path()
        .ok_or_else(|| "Claude Code CLI non installe".to_string())?;

    let system_prompt = include_str!("../resources/4d-coach-prompt.txt");

    let full_prompt = format!(
        "{}\n\nOriginal prompt to improve:\n{}",
        system_prompt, prompt
    );

    let output = tauri::async_runtime::spawn_blocking(move || {
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel();
        let bin = claude_bin.clone();
        let prompt = full_prompt.clone();
        std::thread::spawn(move || {
            let result = std::process::Command::new(&bin)
                .args(["-p", &prompt, "--output-format", "text"])
                .output();
            let _ = tx.send(result);
        });
        match rx.recv_timeout(std::time::Duration::from_secs(120)) {
            Ok(result) => result.map_err(|e| format!("Erreur execution claude: {e}")),
            Err(_) => Err("Timeout : l'amelioration du prompt a pris plus de 2 minutes".to_string()),
        }
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;

    if output.status.success() {
        let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if result.is_empty() {
            Err("Claude n'a pas retourne de reponse".into())
        } else {
            Ok(result)
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Erreur claude: {stderr}"))
    }
}

/// Encode a directory path the same way Claude Code does for its projects folder.
fn encode_project_path(dir: &str) -> String {
    dir.chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect()
}

#[tauri::command]
pub fn list_claude_sessions(project_dir: String) -> Result<String, String> {
    let home = home_dir();
    let encoded = encode_project_path(&project_dir);
    let sessions_dir = std::path::Path::new(&home)
        .join(".claude")
        .join("projects")
        .join(&encoded);

    if !sessions_dir.exists() {
        return Ok("[]".to_string());
    }

    let mut sessions: Vec<(String, u64)> = Vec::new();

    let mut seen = std::collections::HashSet::new();

    if let Ok(entries) = std::fs::read_dir(&sessions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_jsonl = path.extension().map_or(false, |e| e == "jsonl");
            let is_session_dir = path.is_dir()
                && path.file_name().map_or(false, |n| {
                    let s = n.to_string_lossy();
                    s.len() == 36 && s.contains('-') && s != "memory"
                });

            if is_jsonl || is_session_dir {
                let name = if is_jsonl {
                    path.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string())
                } else {
                    path.file_name().and_then(|s| s.to_str()).map(|s| s.to_string())
                };
                if let Some(id) = name {
                    if seen.insert(id.clone()) {
                        let modified = entry.metadata()
                            .and_then(|m| m.modified())
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        sessions.push((id, modified));
                    }
                }
            }
        }
    }

    sessions.sort_by(|a, b| b.1.cmp(&a.1));

    let entries: Vec<serde_json::Value> = sessions.iter()
        .map(|(id, ts)| serde_json::json!({ "id": id, "timestamp": ts }))
        .collect();

    serde_json::to_string(&entries)
        .map_err(|e| format!("JSON serialization failed: {e}"))
}

#[tauri::command]
pub fn get_claude_session_dir(project_dir: String) -> Result<String, String> {
    let home = home_dir();
    let encoded = encode_project_path(&project_dir);
    let sessions_dir = std::path::Path::new(&home)
        .join(".claude")
        .join("projects")
        .join(&encoded);

    if !sessions_dir.exists() {
        return Err("No sessions directory found".to_string());
    }

    Ok(sessions_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_claude_session(project_dir: String, session_id: String) -> Result<(), String> {
    if session_id.chars().any(|c| !c.is_alphanumeric() && c != '-' && c != '_') {
        return Err("Invalid session ID".to_string());
    }
    let home = home_dir();
    let encoded = encode_project_path(&project_dir);
    let sessions_dir = std::path::Path::new(&home)
        .join(".claude")
        .join("projects")
        .join(&encoded);

    let jsonl_path = sessions_dir.join(format!("{session_id}.jsonl"));
    if jsonl_path.exists() {
        std::fs::remove_file(&jsonl_path)
            .map_err(|e| format!("Failed to delete session: {e}"))?;
        return Ok(());
    }

    let dir_path = sessions_dir.join(&session_id);
    if dir_path.exists() {
        std::fs::remove_dir_all(&dir_path)
            .map_err(|e| format!("Failed to delete session: {e}"))?;
    }
    Ok(())
}
