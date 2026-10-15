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

/// Enable session-state hooks in a project's .claude/settings.local.json.
/// Installs the platform-appropriate script, then merges the hook entry —
/// migrating any stale entry (e.g. Unix `.sh` path on Windows) to the new command.
#[tauri::command]
pub fn enable_session_hooks(project_dir: String) -> Result<bool, String> {
    use serde_json::{json, Map, Value};

    // Separate state per conversation so agents in the same project cannot overwrite each other.
    let hook_command = "python3 -c \"_m='orbit-session-state'; import sys,json,hashlib,os,pathlib,time,tempfile; d=json.load(sys.stdin); e=d.get('hook_event_name',''); s={'Stop':'idle','Notification':'waiting'}.get(e,'working'); o={'session_id':d.get('session_id',''),'state':s,'ts':int(time.time()*1000),'tool':d.get('tool_name'),'transcript_path':d.get('transcript_path') if e=='Stop' else None}; h=hashlib.md5((os.getcwd()+d.get('session_id','')).encode()).hexdigest()[:16]; p=pathlib.Path.home()/'.orbit'; p.mkdir(exist_ok=True); f=tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=p,prefix=f'session-{h}-',suffix='.tmp',delete=False); f.write(json.dumps(o)); f.close(); os.replace(f.name,p/f'session-{h}.json')\"";

    let hook_command = if cfg!(windows) {
        hook_command.replacen("python3 ", "python ", 1)
    } else {
        hook_command.to_string()
    };

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

    let events = ["UserPromptSubmit", "Notification", "PreToolUse", "Stop"];

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
                if existing.contains("orbit-session-state") {
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

    let events = ["UserPromptSubmit", "Notification", "PreToolUse", "Stop"];
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
                                    .map(|c| c.contains("orbit-session-state"))
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
    fn installed_hooks_keep_parallel_sessions_in_separate_files() {
        let dir = std::env::temp_dir().join(format!("orbit-hooks-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        enable_session_hooks(dir.to_string_lossy().into()).unwrap();
        let raw = std::fs::read_to_string(dir.join(".claude/settings.local.json")).unwrap();
        let settings: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(
            settings["hooks"]["UserPromptSubmit"].is_array(),
            "working starts on prompt submission, even before the first tool"
        );
        let cmd = settings["hooks"]["Stop"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(cmd.starts_with(if cfg!(windows) {
            "python -c"
        } else {
            "python3 -c"
        }));
        assert!(cmd.contains("session_id"));
        let script = cmd
            .split_once("-c \"")
            .unwrap()
            .1
            .strip_suffix('"')
            .unwrap();
        // Instrument the generated Python, never the user's HOME. Validate the file
        // at the atomic publication boundary and ensure temporary names are unique.
        let instrumented = format!(
            "import os,pathlib,json\nreal_replace=os.replace\ncalls=[]\ndef checked_replace(src,dst):\n src=pathlib.Path(src); dst=pathlib.Path(dst)\n assert src.suffix=='.tmp' and src.parent==dst.parent\n assert dst.name.startswith('session-') and dst.suffix=='.json'\n payload=json.loads(src.read_text()); assert payload['ts']>0\n trace=pathlib.Path.home()/'temp-names'\n names=trace.read_text().splitlines() if trace.exists() else []\n assert str(src) not in names\n trace.write_text('\\n'.join(names+[str(src)]))\n calls.append(str(src)); return real_replace(src,dst)\nos.replace=checked_replace\n{script}\nassert len(calls)==1, 'hook must publish with os.replace'\n"
        );
        for sid in ["agent-one", "agent-two", "agent-one"] {
            use std::io::Write;
            use std::process::{Command, Stdio};
            let mut child = Command::new(if cfg!(windows) { "python" } else { "python3" })
                .args(["-c", &instrumented])
                .current_dir(&dir)
                .env("HOME", &dir)
                .env("USERPROFILE", &dir)
                .stdin(Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(
                    serde_json::json!({"session_id": sid, "hook_event_name": "Stop"})
                        .to_string()
                        .as_bytes(),
                )
                .unwrap();
            assert!(child.wait().unwrap().success());
        }
        let files: Vec<_> = std::fs::read_dir(dir.join(".orbit")).unwrap().collect();
        assert_eq!(
            files.len(),
            2,
            "parallel agents must not overwrite each other's state"
        );
        std::fs::remove_dir_all(dir).unwrap();
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
