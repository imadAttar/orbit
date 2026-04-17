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

/// Filter out clarification/refusal responses that shouldn't become a session title.
fn is_valid_title(title: &str) -> bool {
    if title.is_empty() {
        return false;
    }
    // Questions are never titles
    if title.contains('?') || title.contains('¿') {
        return false;
    }
    let word_count = title.split_whitespace().count();
    if word_count == 0 || word_count > 10 {
        return false;
    }
    if title.chars().count() > 80 {
        return false;
    }
    // Known patterns of clarification/refusal responses
    let lower = title.to_lowercase();
    const INVALID_PATTERNS: &[&str] = &[
        "je ne comprends",
        "je ne peux pas",
        "pourriez-vous",
        "pouvez-vous",
        "clarifier",
        "clarification",
        "préciser",
        "preciser",
        "i don't understand",
        "i cannot",
        "i can't",
        "could you",
        "please clarify",
        "please provide",
        "unclear",
        "what do you",
        "what would you",
        "titre pour",
        "title for",
    ];
    for p in INVALID_PATTERNS {
        if lower.contains(p) {
            return false;
        }
    }
    true
}

#[tauri::command]
pub async fn generate_title(prompt: String) -> Result<String, String> {
    let claude_bin = resolve_claude_path()
        .ok_or_else(|| "Claude Code CLI non installe".to_string())?;

    let system = "You are a title generator. Output ONLY a short title (3-6 words) that summarizes the user's request below. Rules: no quotes, no punctuation, no questions, no clarifications, no alternatives, no explanation. If the request is unclear, infer a plausible topic and still output a title. Never ask questions. Never refuse. Just the title.";
    let full_prompt = format!("{system}\n\nRequest: {prompt}\n\nTitle:");

    let output = tauri::async_runtime::spawn_blocking(move || {
        use std::sync::mpsc;
        let (tx, rx) = mpsc::channel();
        let bin = claude_bin.clone();
        std::thread::spawn(move || {
            let result = std::process::Command::new(&bin)
                .args(["-p", &full_prompt, "--output-format", "text", "--model", "haiku"])
                .output();
            let _ = tx.send(result);
        });
        match rx.recv_timeout(std::time::Duration::from_secs(15)) {
            Ok(result) => result.map_err(|e| format!("Erreur execution claude: {e}")),
            Err(_) => Err("Timeout generation titre".to_string()),
        }
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;

    if output.status.success() {
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // Take only the first line to avoid verbose responses
        let title = raw.lines().next().unwrap_or(&raw).trim();
        // Strip surrounding quotes/asterisks if present
        let title = title.trim_matches(|c| c == '"' || c == '\'' || c == '*').trim();
        if !is_valid_title(title) {
            Err("Titre invalide".into())
        } else {
            Ok(title.to_string())
        }
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Erreur claude: {stderr}"))
    }
}

/// Enable session-state hooks in a project's .claude/settings.local.json.
/// Merges with existing hooks — never duplicates or overwrites.
#[tauri::command]
pub fn enable_session_hooks(project_dir: String) -> Result<bool, String> {
    use serde_json::{json, Map, Value};

    let settings_dir = std::path::Path::new(&project_dir).join(".claude");
    let settings_path = settings_dir.join("settings.local.json");

    // Read existing settings or start fresh
    let mut settings: Value = if settings_path.exists() {
        let raw = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Impossible de lire settings.local.json: {e}"))?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("JSON invalide dans settings.local.json: {e}"))?
    } else {
        json!({})
    };

    let hook_command = "$HOME/.claude/hooks/session-state.sh";

    // The 3 events we need
    let events = ["Notification", "PreToolUse", "Stop"];

    let hooks_obj = settings
        .as_object_mut()
        .ok_or("settings.local.json n'est pas un objet JSON")?
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("hooks n'est pas un objet JSON")?;

    let mut changed = false;

    for event in &events {
        let matchers = hooks_obj
            .entry(event.to_string())
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or(format!("hooks.{event} n'est pas un tableau"))?;

        // Check if our hook is already present in any matcher
        let already_present = matchers.iter().any(|m| {
            m.get("hooks")
                .and_then(|h| h.as_array())
                .map(|arr| {
                    arr.iter().any(|h| {
                        h.get("command")
                            .and_then(|c| c.as_str())
                            .map(|c| c.contains("session-state.sh"))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false)
        });

        if !already_present {
            let mut hook_entry = Map::new();
            hook_entry.insert("type".into(), json!("command"));
            hook_entry.insert("command".into(), json!(hook_command));
            hook_entry.insert("timeout".into(), json!(3000));

            let mut matcher = Map::new();
            matcher.insert("matcher".into(), json!(""));
            matcher.insert("hooks".into(), json!([hook_entry]));

            matchers.push(json!(matcher));
            changed = true;
        }
    }

    if changed {
        std::fs::create_dir_all(&settings_dir)
            .map_err(|e| format!("Impossible de creer .claude/: {e}"))?;
        let formatted = serde_json::to_string_pretty(&settings)
            .map_err(|e| format!("Erreur serialisation JSON: {e}"))?;
        std::fs::write(&settings_path, formatted)
            .map_err(|e| format!("Impossible d'ecrire settings.local.json: {e}"))?;
    }

    Ok(changed)
}

/// Check if session-state hooks are already enabled in a project.
#[tauri::command]
pub fn check_session_hooks(project_dir: String) -> bool {
    let settings_path = std::path::Path::new(&project_dir)
        .join(".claude")
        .join("settings.local.json");

    let Ok(raw) = std::fs::read_to_string(&settings_path) else {
        return false;
    };
    let Ok(settings) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };

    let events = ["Notification", "PreToolUse", "Stop"];
    events.iter().all(|event| {
        settings
            .get("hooks")
            .and_then(|h| h.get(*event))
            .and_then(|m| m.as_array())
            .map(|arr| {
                arr.iter().any(|m| {
                    m.get("hooks")
                        .and_then(|h| h.as_array())
                        .map(|hs| {
                            hs.iter().any(|h| {
                                h.get("command")
                                    .and_then(|c| c.as_str())
                                    .map(|c| c.contains("session-state.sh"))
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

