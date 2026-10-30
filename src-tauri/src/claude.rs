use crate::pty::home_dir;
use std::sync::Mutex;

/// Cache successful lookups only; a missing installation must be discoverable later.
static CLAUDE_PATH: Mutex<Option<String>> = Mutex::new(None);

/// Resolve the full path to the `claude` binary.
/// Desktop apps launched from Finder/Explorer have a minimal PATH.
pub(crate) fn resolve_claude_path() -> Option<String> {
    resolve_claude_path_cached(&CLAUDE_PATH, resolve_claude_path_inner, |path| {
        std::path::Path::new(path).is_file()
    })
}

fn resolve_claude_path_cached(
    cache: &Mutex<Option<String>>,
    discover: impl FnOnce() -> Option<String>,
    is_valid: impl Fn(&str) -> bool,
) -> Option<String> {
    let mut cached = cache.lock().unwrap_or_else(|error| error.into_inner());
    if !cached.as_deref().is_some_and(&is_valid) {
        *cached = discover().filter(|path| is_valid(path));
    }
    cached.clone()
}

/// Candidate paths for the `claude` binary on Unix (macOS, Linux).
#[cfg(any(not(target_os = "windows"), test))]
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
#[cfg(any(target_os = "windows", test))]
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

/// Build a useful local title when the optional AI title request is unavailable.
fn fallback_title(prompt: &str) -> String {
    let mut words: Vec<&str> = prompt.split_whitespace().collect();

    while words.first().is_some_and(|word| word.starts_with('/')) {
        words.remove(0);
    }

    const POLITE_PREFIXES: &[&[&str]] = &[
        &["Peux-tu"],
        &["Pouvez-vous"],
        &["Can", "you"],
        &["Could", "you"],
        &["Please"],
    ];
    for prefix in POLITE_PREFIXES {
        if words.len() >= prefix.len()
            && words[..prefix.len()]
                .iter()
                .zip(prefix.iter())
                .all(|(word, expected)| word.eq_ignore_ascii_case(expected))
        {
            words.drain(..prefix.len());
            break;
        }
    }

    let mut title = words
        .into_iter()
        .take(7)
        .map(|word| word.trim_matches(|c: char| c.is_ascii_punctuation()))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    if title.is_empty() {
        return "Session".into();
    }

    if let Some(first) = title.chars().next() {
        let uppercase = first.to_uppercase().collect::<String>();
        title.replace_range(..first.len_utf8(), &uppercase);
    }
    title.chars().take(80).collect()
}

/// Session titles are generated locally: no subprocess, network, or additional cost.
#[tauri::command]
pub async fn generate_title(prompt: String) -> Result<String, String> {
    Ok(fallback_title(&prompt))
}

/// Extract the last user message from a Claude Code JSONL transcript.
fn read_last_user_message(path: &str) -> Result<String, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Impossible de lire le transcript: {e}"))?;

    for line in content.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };

        let role = msg
            .get("role")
            .and_then(|r| r.as_str())
            .or_else(|| {
                msg.get("message")
                    .and_then(|m| m.get("role"))
                    .and_then(|r| r.as_str())
            })
            .unwrap_or("");

        if role != "user" {
            continue;
        }

        let content_val = msg
            .get("content")
            .or_else(|| msg.get("message").and_then(|m| m.get("content")));

        if let Some(val) = content_val {
            if let Some(s) = val.as_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    return Ok(trimmed.chars().take(500).collect());
                }
            }
            if let Some(arr) = val.as_array() {
                for block in arr {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                return Ok(trimmed.chars().take(500).collect());
                            }
                        }
                    }
                }
            }
        }
    }

    Err("Aucun message utilisateur trouvé".into())
}

/// Read the last user message and derive a local title without an AI request.
#[tauri::command]
pub async fn generate_session_title(transcript_path: String) -> Result<String, String> {
    let prompt = read_last_user_message(&transcript_path)?;
    generate_title(prompt).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_path_cache_retries_after_missing_installation() {
        let cache = Mutex::new(None);
        assert_eq!(resolve_claude_path_cached(&cache, || None, |_| true), None);
        assert_eq!(
            resolve_claude_path_cached(&cache, || Some("/test/claude".into()), |_| true),
            Some("/test/claude".into()),
            "a failed lookup must not hide a later installation"
        );
    }

    #[test]
    fn claude_path_cache_rediscovers_stale_path() {
        let cache = Mutex::new(None);
        assert_eq!(
            resolve_claude_path_cached(&cache, || Some("/old/claude".into()), |_| true),
            Some("/old/claude".into())
        );
        assert_eq!(
            resolve_claude_path_cached(
                &cache,
                || Some("/new/claude".into()),
                |path| path == "/new/claude",
            ),
            Some("/new/claude".into()),
            "a removed binary must trigger a fresh lookup"
        );
    }

    #[test]
    fn claude_path_cache_rejects_invalid_discovery() {
        let cache = Mutex::new(None);
        assert_eq!(
            resolve_claude_path_cached(&cache, || Some("/removed/claude".into()), |_| false),
            None,
            "a lookup result that is no longer a file must not be cached"
        );
        assert_eq!(*cache.lock().unwrap(), None);
    }

    #[test]
    fn claude_path_cache_reuses_valid_path_without_discovery() {
        let cache = Mutex::new(Some("/test/claude".into()));
        assert_eq!(
            resolve_claude_path_cached(
                &cache,
                || panic!("a valid cache entry must skip discovery"),
                |path| path == "/test/claude",
            ),
            Some("/test/claude".into())
        );
    }

    #[test]
    fn claude_path_cache_clears_removed_path_and_allows_reinstallation() {
        let cache = Mutex::new(Some("/old/claude".into()));
        assert_eq!(resolve_claude_path_cached(&cache, || None, |_| false), None);
        assert_eq!(*cache.lock().unwrap(), None);
        assert_eq!(
            resolve_claude_path_cached(&cache, || Some("/new/claude".into()), |_| true),
            Some("/new/claude".into())
        );
    }

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

    #[test]
    fn fallback_title_uses_meaningful_prompt_words() {
        assert_eq!(
            fallback_title("Peux-tu corriger le bug de connexion sur Windows ?"),
            "Corriger le bug de connexion sur Windows"
        );
    }

    #[test]
    fn fallback_title_skips_commands_and_truncates_long_prompts() {
        assert_eq!(
            fallback_title("/plan Ajouter une authentification robuste avec rotation automatique des jetons et journalisation detaillee"),
            "Ajouter une authentification robuste avec rotation automatique"
        );
    }

    #[test]
    fn fallback_title_handles_empty_prompt() {
        assert_eq!(fallback_title("  /coach   "), "Session");
    }

    #[test]
    fn session_title_is_immediate_and_local_even_when_claude_is_installed() {
        let title =
            tauri::async_runtime::block_on(generate_title("Peux-tu corriger la connexion".into()))
                .unwrap();
        assert_eq!(title, "Corriger la connexion");
    }

    #[test]
    fn local_title_is_bounded_for_single_unbroken_input() {
        assert!(fallback_title(&"é".repeat(1000)).chars().count() <= 80);
    }
}
