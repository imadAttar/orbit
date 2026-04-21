use crate::pty::home_dir;
use std::path::Path;
use std::sync::OnceLock;

/// Cached claude binary path — resolved once, reused across all PTY spawns.
static CLAUDE_PATH: OnceLock<Option<String>> = OnceLock::new();

/// Resolve the full path to the `claude` binary.
/// Desktop apps launched from Finder/Explorer have a minimal PATH.
pub(crate) fn resolve_claude_path() -> Option<String> {
    CLAUDE_PATH.get_or_init(resolve_claude_path_inner).clone()
}

/// Candidate paths for the `claude` binary on Unix (macOS, Linux).
fn unix_claude_candidates(home: &str) -> Vec<String> {
    vec![
        format!("{home}/.local/bin/claude"),
        format!("{home}/.npm-global/bin/claude"),
        "/opt/homebrew/bin/claude".into(),
        "/usr/local/bin/claude".into(),
    ]
}

/// Candidate paths for the `claude` binary on Windows.
/// `.exe` is preferred over `.cmd` because stdlib `Command::new` quoting of
/// argv containing shell metacharacters is fragile for `.cmd` shims
/// (CVE-2024-24576 / BatBadBut, mitigated in Rust ≥ 1.77.2 but still emits
/// errors rather than executing safely).
fn windows_claude_candidates(home: &str) -> Vec<String> {
    vec![
        format!("{home}\\.local\\bin\\claude.exe"),
        format!("{home}\\AppData\\Roaming\\npm\\claude.exe"),
        format!("{home}\\AppData\\Roaming\\npm\\claude.cmd"),
        "C:\\Program Files\\nodejs\\claude.exe".into(),
        "C:\\Program Files\\nodejs\\claude.cmd".into(),
    ]
}

fn resolve_claude_path_inner() -> Option<String> {
    let home = home_dir();

    #[cfg(not(target_os = "windows"))]
    let candidates = unix_claude_candidates(&home);

    #[cfg(target_os = "windows")]
    let candidates = windows_claude_candidates(&home);

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

/// Install the session-state hook script to ~/.claude/hooks/ and return the
/// shell command Claude Code should execute. Script contents are embedded at
/// compile time; the file is rewritten on every call so upgrades pick up fixes.
fn install_session_hook_script() -> Result<String, String> {
    let home = home_dir();
    if home.is_empty() {
        return Err("Impossible de resoudre le repertoire home".into());
    }
    let hooks_dir = std::path::PathBuf::from(&home).join(".claude").join("hooks");
    std::fs::create_dir_all(&hooks_dir)
        .map_err(|e| format!("Impossible de creer ~/.claude/hooks/: {e}"))?;

    #[cfg(target_os = "windows")]
    {
        let script_path = hooks_dir.join("session-state.ps1");
        let content = include_str!("../resources/session-state.ps1");
        std::fs::write(&script_path, content)
            .map_err(|e| format!("Impossible d'ecrire session-state.ps1: {e}"))?;
        Ok(build_hook_command_windows(&script_path))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let script_path = hooks_dir.join("session-state.sh");
        let content = include_str!("../resources/session-state.sh");
        std::fs::write(&script_path, content)
            .map_err(|e| format!("Impossible d'ecrire session-state.sh: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&script_path)
                .map_err(|e| format!("stat session-state.sh: {e}"))?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&script_path, perms)
                .map_err(|e| format!("chmod session-state.sh: {e}"))?;
        }
        Ok(build_hook_command_unix(&script_path))
    }
}

/// Build the shell command string that Claude Code will execute for the Unix
/// `.sh` hook script. The command is passed to bash, so a path containing a
/// space (e.g. `/Users/jean pierre/...`) MUST be quoted to prevent word-splitting.
fn build_hook_command_unix(script_path: &Path) -> String {
    let path = script_path.to_string_lossy();
    // Bash single-quotes prevent all expansion/splitting. Escape any literal
    // single-quote inside the path with the usual `'\''` sequence.
    let escaped = path.replace('\'', r"'\''");
    format!("'{escaped}'")
}

/// Build the shell command string that Claude Code will execute for the Windows
/// `.ps1` hook script. Claude Code invokes hooks via bash by default (Git Bash
/// on Windows), so we wrap a `powershell` invocation. Forward slashes are used
/// because backslashes in bash double-quoted strings can be interpreted as
/// escape sequences. The path is enclosed in double quotes, so spaces in the
/// home directory survive the bash tokenizer.
/// `-WindowStyle Hidden` prevents a console window from flashing each time a
/// hook fires (Notification / PreToolUse / Stop).
fn build_hook_command_windows(script_path: &Path) -> String {
    let path_str = script_path.to_string_lossy().replace('\\', "/");
    // Escape any `"` in the path (extremely unusual on Windows but defensively
    // handled) and any `$` so bash doesn't variable-expand on the way through.
    let escaped = path_str.replace('"', "\\\"").replace('$', "\\$");
    format!(
        "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{escaped}\""
    )
}

/// True if the given hook command string refers to Orbit's session-state hook,
/// regardless of platform variant (.sh or .ps1), path separator, or legacy
/// `$HOME` expansion. The match is anchored on `.claude/hooks/session-state.`
/// to reject lookalikes (e.g. an unrelated user script named `session-state.sh`
/// in a different directory).
fn is_session_state_command(cmd: &str) -> bool {
    let normalized = cmd.replace('\\', "/");
    normalized.contains(".claude/hooks/session-state.sh")
        || normalized.contains(".claude/hooks/session-state.ps1")
}

/// Enable session-state hooks in a project's .claude/settings.local.json.
/// Installs the platform-appropriate script, then merges the hook entry —
/// migrating any stale entry (e.g. Unix `.sh` path on Windows) to the new command.
#[tauri::command]
pub fn enable_session_hooks(project_dir: String) -> Result<bool, String> {
    use serde_json::{json, Map, Value};

    let hook_command = install_session_hook_script()?;

    let settings_dir = std::path::Path::new(&project_dir).join(".claude");
    let settings_path = settings_dir.join("settings.local.json");

    let mut settings: Value = if settings_path.exists() {
        let raw = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Impossible de lire settings.local.json: {e}"))?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("JSON invalide dans settings.local.json: {e}"))?
    } else {
        json!({})
    };

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

        let mut found = false;
        for matcher in matchers.iter_mut() {
            let Some(hooks) = matcher.get_mut("hooks").and_then(|h| h.as_array_mut()) else {
                continue;
            };
            for h in hooks.iter_mut() {
                let existing = h.get("command").and_then(|c| c.as_str()).unwrap_or("");
                if is_session_state_command(existing) {
                    found = true;
                    if existing != hook_command {
                        h.as_object_mut()
                            .ok_or(format!("hooks.{event} entry is not an object"))?
                            .insert("command".into(), json!(hook_command));
                        changed = true;
                    }
                }
            }
        }

        if !found {
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
                                    .map(is_session_state_command)
                                    .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // --- is_session_state_command ---

    #[test]
    fn is_session_state_command_matches_unix_path() {
        assert!(is_session_state_command(
            "/Users/u/.claude/hooks/session-state.sh"
        ));
        assert!(is_session_state_command(
            "'/Users/u/.claude/hooks/session-state.sh'"
        ));
    }

    #[test]
    fn is_session_state_command_matches_windows_powershell_invocation() {
        let cmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"C:/Users/u/.claude/hooks/session-state.ps1\"";
        assert!(is_session_state_command(cmd));
    }

    #[test]
    fn is_session_state_command_matches_windows_backslash_path() {
        let cmd = "C:\\Users\\u\\.claude\\hooks\\session-state.ps1";
        assert!(is_session_state_command(cmd));
    }

    #[test]
    fn is_session_state_command_matches_legacy_home_variable() {
        assert!(is_session_state_command(
            "$HOME/.claude/hooks/session-state.sh"
        ));
    }

    #[test]
    fn is_session_state_command_rejects_unrelated_tool_same_filename() {
        // Another tool using the same filename in a different location must NOT
        // be rewritten by Orbit's migration logic.
        assert!(!is_session_state_command("/opt/mytool/session-state.sh"));
        assert!(!is_session_state_command("C:/MyScripts/session-state.ps1"));
        assert!(!is_session_state_command("./session-state.sh foo"));
    }

    #[test]
    fn is_session_state_command_rejects_empty_and_unrelated_strings() {
        assert!(!is_session_state_command(""));
        assert!(!is_session_state_command("echo hello"));
        assert!(!is_session_state_command("session-state.sh"));
    }

    // --- build_hook_command_unix ---

    #[test]
    fn build_hook_command_unix_simple_path() {
        let path = PathBuf::from("/Users/u/.claude/hooks/session-state.sh");
        let cmd = build_hook_command_unix(&path);
        assert_eq!(cmd, "'/Users/u/.claude/hooks/session-state.sh'");
    }

    #[test]
    fn build_hook_command_unix_quotes_path_with_space() {
        // A home directory containing a space (e.g. macOS "Jean Pierre") MUST
        // survive bash word-splitting, so the path is single-quoted.
        let path = PathBuf::from("/Users/jean pierre/.claude/hooks/session-state.sh");
        let cmd = build_hook_command_unix(&path);
        assert_eq!(
            cmd,
            "'/Users/jean pierre/.claude/hooks/session-state.sh'"
        );
    }

    #[test]
    fn build_hook_command_unix_escapes_single_quote_in_path() {
        let path = PathBuf::from("/Users/o'brien/.claude/hooks/session-state.sh");
        let cmd = build_hook_command_unix(&path);
        // Standard bash-safe escape: 'O'\''Brien' closes, escapes, re-opens.
        assert_eq!(
            cmd,
            r"'/Users/o'\''brien/.claude/hooks/session-state.sh'"
        );
    }

    #[test]
    fn build_hook_command_unix_is_recognized_by_matcher() {
        // Round-trip: a command we produce must be matched by the detector.
        let path = PathBuf::from("/Users/jean pierre/.claude/hooks/session-state.sh");
        let cmd = build_hook_command_unix(&path);
        assert!(is_session_state_command(&cmd));
    }

    // --- build_hook_command_windows ---

    #[test]
    fn build_hook_command_windows_contains_powershell_and_script() {
        let path = PathBuf::from(r"C:\Users\u\.claude\hooks\session-state.ps1");
        let cmd = build_hook_command_windows(&path);
        assert!(cmd.contains("powershell"));
        assert!(cmd.contains("-NoProfile"));
        assert!(cmd.contains("-ExecutionPolicy Bypass"));
        assert!(cmd.contains("-WindowStyle Hidden"));
        assert!(cmd.contains("session-state.ps1"));
    }

    #[test]
    fn build_hook_command_windows_uses_forward_slashes() {
        // Forward slashes survive bash double-quoted strings; backslashes don't.
        let path = PathBuf::from(r"C:\Users\u\.claude\hooks\session-state.ps1");
        let cmd = build_hook_command_windows(&path);
        assert!(cmd.contains("C:/Users/u/.claude/hooks/session-state.ps1"));
        assert!(!cmd.contains(r"C:\Users\u"));
    }

    #[test]
    fn build_hook_command_windows_is_recognized_by_matcher() {
        let path = PathBuf::from(r"C:\Users\u\.claude\hooks\session-state.ps1");
        let cmd = build_hook_command_windows(&path);
        assert!(is_session_state_command(&cmd));
    }

    #[test]
    fn build_hook_command_windows_preserves_space_in_path() {
        // The path lives inside double quotes, so bash tokenization keeps it
        // as a single argument even with spaces (common Windows username
        // scenarios like "John Smith"). The forward-slash form must still appear.
        let path = PathBuf::from(r"C:\Users\John Smith\.claude\hooks\session-state.ps1");
        let cmd = build_hook_command_windows(&path);
        assert!(cmd.contains("\"C:/Users/John Smith/.claude/hooks/session-state.ps1\""));
    }

    #[test]
    fn build_hook_command_windows_escapes_dollar_and_quote() {
        // Defensive: the path goes into a bash double-quoted string where `$`
        // triggers variable expansion and `"` closes the string.
        let path = PathBuf::from(r#"C:\Users\weird$name\.claude\hooks\session-state.ps1"#);
        let cmd = build_hook_command_windows(&path);
        assert!(cmd.contains(r"\$name"), "got: {cmd}");
    }

    // --- claude binary candidates ---

    #[test]
    fn windows_claude_candidates_prefer_exe_over_cmd_in_npm_dir() {
        let candidates = windows_claude_candidates("C:\\Users\\u");
        let npm = "AppData\\Roaming\\npm";
        let exe_pos = candidates
            .iter()
            .position(|c| c.contains(npm) && c.ends_with(".exe"));
        let cmd_pos = candidates
            .iter()
            .position(|c| c.contains(npm) && c.ends_with(".cmd"));
        assert!(
            exe_pos.is_some() && cmd_pos.is_some(),
            "both .exe and .cmd npm candidates must exist"
        );
        assert!(
            exe_pos.unwrap() < cmd_pos.unwrap(),
            "prefer .exe over .cmd to avoid BatBadBut (CVE-2024-24576) quoting issues"
        );
    }

    #[test]
    fn windows_claude_candidates_prefer_exe_over_cmd_in_program_files() {
        let candidates = windows_claude_candidates("C:\\Users\\u");
        let pf = "Program Files\\nodejs";
        let exe_pos = candidates
            .iter()
            .position(|c| c.contains(pf) && c.ends_with(".exe"));
        let cmd_pos = candidates
            .iter()
            .position(|c| c.contains(pf) && c.ends_with(".cmd"));
        assert!(
            exe_pos.is_some() && cmd_pos.is_some(),
            "both .exe and .cmd Program Files candidates must exist"
        );
        assert!(exe_pos.unwrap() < cmd_pos.unwrap());
    }

    #[test]
    fn unix_claude_candidates_include_homebrew_and_local_bin() {
        let candidates = unix_claude_candidates("/Users/u");
        assert!(candidates.iter().any(|c| c == "/Users/u/.local/bin/claude"));
        assert!(candidates.iter().any(|c| c == "/opt/homebrew/bin/claude"));
        assert!(candidates.iter().any(|c| c == "/usr/local/bin/claude"));
    }
}
