use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri::Emitter;

// --- Types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    pub name: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Default)]
struct ActivitySignals {
    tools_used: HashMap<String, u32>,
    skills_invoked: Vec<String>,
    files_edited: Vec<String>,
    file_extensions: HashSet<String>,
    commands_run: Vec<String>,
    keywords: HashSet<String>,
    activity_patterns: HashSet<String>,
    last_assistant_message: String,
}

#[derive(Debug, Deserialize)]
struct TranscriptEntry {
    role: Option<String>,
    content: Option<serde_json::Value>,
}

// --- Keyword patterns (ported from analyzer.ts) ---

struct KeywordPattern {
    regex: Regex,
    keyword: &'static str,
}

/// Cached keyword patterns — compiled once, reused across all calls.
static KEYWORD_PATTERNS: LazyLock<Vec<KeywordPattern>> = LazyLock::new(|| {
    let patterns: Vec<(&str, &str)> = vec![
        (r"(?i)\b(test|spec|jest|vitest|pytest|mocha)\b", "test"),
        (r"(?i)\b(deploy|deployment|ci|cd|pipeline|github.actions)\b", "deploy"),
        (r"(?i)\b(docker|container|dockerfile|compose)\b", "docker"),
        (r"(?i)\b(api|endpoint|route|rest|graphql)\b", "api"),
        (r"(?i)\b(database|schema|migration|sql|prisma|drizzle|postgres|mysql|mongo)\b", "database"),
        (r"(?i)\b(auth|authentication|login|session|jwt|oauth)\b", "auth"),
        (r"(?i)\b(security|vulnerability|owasp|xss|injection|csrf)\b", "security"),
        (r"(?i)\b(performance|optimize|slow|latency|profil)\b", "performance"),
        (r"(?i)\b(refactor|cleanup|legacy|tech.debt)\b", "refactor"),
        (r"(?i)\b(bug|fix|error|crash|broken|debug)\b", "bug"),
        (r"(?i)\b(frontend|react|vue|svelte|css|tailwind|component|ui)\b", "frontend"),
        (r"(?i)\b(backend|server|express|fastify|hono|nest)\b", "backend"),
        (r"(?i)\b(design.system|tokens|palette|typography|spacing)\b", "design-system"),
        (r"(?i)\b(pr|pull.request|merge|branch)\b", "pr"),
        (r"(?i)\b(commit|git)\b", "git"),
        (r"(?i)\b(docs|documentation|readme|jsdoc)\b", "docs"),
        (r"(?i)\b(seo|meta.tags|search.ranking)\b", "seo"),
        (r"(?i)\b(email|newsletter|drip|sequence)\b", "email"),
        (r"(?i)\b(pricing|monetization|tier)\b", "pricing"),
        (r"(?i)\b(okr|kpi|metric|goal)\b", "metrics"),
        (r"(?i)\b(launch|gtm|go.to.market)\b", "gtm"),
        (r"(?i)\b(accessibility|a11y|wcag|aria)\b", "a11y"),
        (r"(?i)\b(regex|pattern.match)\b", "regex"),
        (r"(?i)\b(monorepo|workspace|turborepo|nx)\b", "monorepo"),
        (r"(?i)\b(gdpr|privacy|compliance|cookie.consent)\b", "privacy"),
        (r"(?i)\b(contract|legal|nda|terms)\b", "legal"),
        (r"(?i)\b(sprint|agile|scrum|backlog|story.point)\b", "sprint"),
        (r"(?i)\b(roadmap|planning|priorit)\b", "planning"),
        (r"(?i)\b(idea|prototype|mvp|from.scratch)\b", "idea"),
        (r"(?i)\b(incident|outage|production.down)\b", "incident"),
        (r"(?i)\b(e2e|playwright|cypress|browser.test)\b", "e2e"),
        (r"(?i)\b(bundle|webpack|vite|tree.shak|code.split)\b", "bundle"),
        (r"(?i)\b(env|config|secret|dotenv)\b", "env-config"),
        (r"(?i)\b(skill|hook|claude\.md)\b", "claude-meta"),
    ];
    patterns
        .into_iter()
        .filter_map(|(pat, kw)| Regex::new(pat).ok().map(|r| KeywordPattern { regex: r, keyword: kw }))
        .collect()
});

// --- TAG_MAP (ported from cli.ts) ---

static TAG_MAP: LazyLock<HashMap<&'static str, Vec<&'static str>>> = LazyLock::new(|| {
    HashMap::from([
        ("build", vec!["code-writing", "feature-impl", "deployment"]),
        ("test", vec!["test-writing", "test", "test-failure"]),
        ("dev", vec!["code-writing", "feature-impl", "frontend-work"]),
        ("server", vec!["api-scaffold", "backend", "code-writing"]),
        ("e2e", vec!["e2e", "test-writing", "frontend-work"]),
        ("review", vec!["code-review", "pr-ready", "feature-impl"]),
        ("debug", vec!["bug-fix", "error-investigation", "incident"]),
        ("ci", vec!["deployment", "cicd", "test-writing"]),
        ("release", vec!["deployment", "pr-ready", "commit"]),
        ("explore", vec!["code-writing", "feature-planning", "architecture"]),
        ("oneshot", vec!["code-writing", "feature-impl"]),
        ("commit", vec!["commit", "branch-work", "git"]),
        ("pr", vec!["pr-ready", "commit", "branch-work"]),
        ("fix", vec!["bug-fix", "error-investigation"]),
        ("deploy", vec!["deployment", "cicd"]),
        ("lint", vec!["code-writing", "code-review"]),
        ("format", vec!["code-writing", "code-review"]),
        ("migrate", vec!["migration", "database-design"]),
        ("scaffold", vec!["api-scaffold", "feature-planning"]),
        ("doc", vec!["doc-generation", "code-writing"]),
        ("security", vec!["security", "auth-work"]),
        ("perf", vec!["performance", "code-review"]),
        ("refactor", vec!["refactor", "code-writing"]),
        ("tauri", vec!["deployment", "frontend-work", "feature-impl"]),
        ("status", vec!["deployment", "cicd", "monitoring"]),
        ("coach", vec!["project-setup", "session-end"]),
        ("standup", vec!["project-setup", "git"]),
    ])
});

// --- Transcript analysis ---

fn extract_keywords(text: &str, keywords: &mut HashSet<String>, patterns: &[KeywordPattern]) {
    for kp in patterns {
        if kp.regex.is_match(text) {
            keywords.insert(kp.keyword.to_string());
        }
    }
}

fn extract_extension(file_path: &str) -> Option<String> {
    Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
}

fn process_entry(entry: &TranscriptEntry, signals: &mut ActivitySignals, patterns: &[KeywordPattern]) {
    if let Some(role) = &entry.role {
        if role == "assistant" {
            if let Some(serde_json::Value::Array(blocks)) = &entry.content {
                for block in blocks {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    if block_type == "tool_use" {
                        if let Some(name) = block.get("name").and_then(|v| v.as_str()) {
                            *signals.tools_used.entry(name.to_string()).or_insert(0) += 1;

                            if let Some(input) = block.get("input").and_then(|v| v.as_object()) {
                                if name == "Skill" {
                                    if let Some(skill) = input.get("skill").and_then(|v| v.as_str()) {
                                        signals.skills_invoked.push(skill.to_string());
                                    }
                                }
                                if name == "Edit" || name == "Write" {
                                    if let Some(fp) = input.get("file_path").and_then(|v| v.as_str()) {
                                        signals.files_edited.push(fp.to_string());
                                        if let Some(ext) = extract_extension(fp) {
                                            signals.file_extensions.insert(ext);
                                        }
                                    }
                                }
                                if name == "Bash" {
                                    if let Some(cmd) = input.get("command").and_then(|v| v.as_str()) {
                                        let truncated: String = cmd.chars().take(200).collect();
                                        signals.commands_run.push(truncated);
                                    }
                                }
                            }
                        }
                    }

                    if block_type == "text" {
                        if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                            extract_keywords(text, &mut signals.keywords, patterns);
                        }
                    }
                }
            }
        }

        if role == "user" {
            let text = match &entry.content {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(serde_json::Value::Array(blocks)) => blocks
                    .iter()
                    .filter(|b| b.get("type").and_then(|v| v.as_str()) == Some("text"))
                    .filter_map(|b| b.get("text").and_then(|v| v.as_str()))
                    .collect::<Vec<_>>()
                    .join(" "),
                _ => String::new(),
            };
            if !text.is_empty() {
                extract_keywords(&text, &mut signals.keywords, patterns);
            }
        }
    }
}

fn derive_patterns(signals: &mut ActivitySignals) {
    let git_commit_re = Regex::new(r"git\s+(commit|push|merge|rebase|branch)").ok();
    let gh_pr_re = Regex::new(r"gh\s+pr").ok();
    let test_file_re = Regex::new(r"\.(test|spec)\.[jt]sx?$").ok();

    if signals.tools_used.contains_key("Edit") || signals.tools_used.contains_key("Write") {
        signals.activity_patterns.insert("code-writing".into());
        signals.activity_patterns.insert("feature-impl".into());
    }

    let frontend_exts: HashSet<&str> = ["tsx", "jsx", "css", "scss", "html", "svelte", "vue"]
        .iter()
        .copied()
        .collect();
    if signals.file_extensions.iter().any(|e| frontend_exts.contains(e.as_str()))
        || signals.keywords.contains("frontend")
    {
        signals.activity_patterns.insert("frontend-work".into());
        signals.activity_patterns.insert("ui-component".into());
    }

    if signals.keywords.contains("api") || signals.keywords.contains("backend") {
        signals.activity_patterns.insert("api-scaffold".into());
    }

    if signals.keywords.contains("database")
        || signals.file_extensions.iter().any(|e| e == "sql" || e == "prisma")
    {
        signals.activity_patterns.insert("database-work".into());
        signals.activity_patterns.insert("database-design".into());
    }

    if signals.keywords.contains("test")
        || test_file_re.as_ref().map_or(false, |re| signals.files_edited.iter().any(|f| re.is_match(f)))
    {
        signals.activity_patterns.insert("test-writing".into());
    }

    if let Some(ref re) = git_commit_re {
        if signals.commands_run.iter().any(|c| re.is_match(c)) {
            signals.activity_patterns.insert("commit".into());
            signals.activity_patterns.insert("branch-work".into());
        }
    }
    if signals.keywords.contains("pr") {
        signals.activity_patterns.insert("pr-ready".into());
    } else if let Some(ref re) = gh_pr_re {
        if signals.commands_run.iter().any(|c| re.is_match(c)) {
            signals.activity_patterns.insert("pr-ready".into());
        }
    }

    if signals.keywords.contains("bug") {
        signals.activity_patterns.insert("bug-fix".into());
        signals.activity_patterns.insert("error-investigation".into());
    }
    if signals.keywords.contains("refactor") {
        signals.activity_patterns.insert("refactor".into());
    }
    if signals.keywords.contains("deploy") || signals.keywords.contains("docker") {
        signals.activity_patterns.insert("deployment".into());
    }
    if signals.keywords.contains("planning")
        || signals.keywords.contains("idea")
        || signals.keywords.contains("sprint")
    {
        signals.activity_patterns.insert("feature-planning".into());
    }
    if signals.keywords.contains("auth") {
        signals.activity_patterns.insert("auth-work".into());
    }
    if signals.keywords.contains("incident") {
        signals.activity_patterns.insert("incident".into());
    }
    if signals.keywords.contains("claude-meta")
        || signals
            .skills_invoked
            .iter()
            .any(|s| s == "bootstrap" || s == "claude-md-optimizer")
    {
        signals.activity_patterns.insert("project-setup".into());
    }
    if signals.keywords.contains("gtm")
        || signals.keywords.contains("pricing")
        || signals.keywords.contains("seo")
    {
        signals.activity_patterns.insert("marketing".into());
        signals.activity_patterns.insert("gtm".into());
    }
    if signals.keywords.contains("legal") || signals.keywords.contains("privacy") {
        signals.activity_patterns.insert("legal".into());
    }
    if signals.keywords.contains("database") || signals.keywords.contains("metrics") {
        signals.activity_patterns.insert("data-analysis".into());
    }
}

fn analyze_transcript(transcript_path: &str, last_message: &str) -> ActivitySignals {
    let patterns = &*KEYWORD_PATTERNS;
    let mut signals = ActivitySignals {
        last_assistant_message: last_message.to_string(),
        ..Default::default()
    };

    if let Ok(content) = fs::read_to_string(transcript_path) {
        let lines: Vec<&str> = content.lines().collect();
        let start = if lines.len() > 50 { lines.len() - 50 } else { 0 };
        for line in &lines[start..] {
            if let Ok(entry) = serde_json::from_str::<TranscriptEntry>(line) {
                process_entry(&entry, &mut signals, &patterns);
            }
        }
    }

    if !signals.last_assistant_message.is_empty() {
        extract_keywords(&signals.last_assistant_message, &mut signals.keywords, &patterns);
    }

    derive_patterns(&mut signals);
    signals
}

// --- Bookmark scoring ---

fn score_bookmark(
    bm: &Bookmark,
    activity_patterns: &HashSet<String>,
    keywords: &HashSet<String>,
    tags: &HashMap<&str, Vec<&str>>,
) -> i64 {
    let text = format!("{} {}", bm.name, bm.prompt).to_lowercase();
    let mut score: i64 = 0;

    let mut bm_tags: HashSet<&str> = HashSet::new();
    for (keyword, ktags) in tags {
        if text.contains(keyword) {
            for t in ktags {
                bm_tags.insert(t);
            }
        }
    }

    for tag in &bm_tags {
        if activity_patterns.contains(*tag) {
            score += 30;
        }
    }

    for kw in keywords {
        if text.contains(kw.as_str()) {
            score += 15;
        }
    }

    score
}

// --- Skill scanner ---

fn parse_skill_frontmatter(content: &str) -> Option<(String, String)> {
    if !content.starts_with("---") {
        return None;
    }
    let end = content[3..].find("---")?;
    let frontmatter = &content[3..3 + end];

    let mut name = String::new();
    let mut description = String::new();

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("name:") {
            name = val.trim().trim_matches('"').trim_matches('\'').to_string();
        } else if let Some(val) = line.strip_prefix("description:") {
            description = val.trim().trim_matches('"').trim_matches('\'').to_string();
        }
    }

    if name.is_empty() {
        return None;
    }
    Some((name, description))
}

fn scan_skills(project_dir: &str) -> Vec<SkillInfo> {
    let skills_dir = Path::new(project_dir).join(".claude").join("skills");
    let mut skills = Vec::new();

    let entries = match fs::read_dir(&skills_dir) {
        Ok(e) => e,
        Err(_) => return skills,
    };

    for entry in entries.flatten() {
        if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            continue;
        }
        let skill_md = entry.path().join("SKILL.md");
        if let Ok(content) = fs::read_to_string(&skill_md) {
            if let Some((name, description)) = parse_skill_frontmatter(&content) {
                // Use full content as prompt (after frontmatter)
                let prompt_start = content[3..].find("---").map(|i| i + 6).unwrap_or(0);
                let prompt = content[prompt_start..].trim().to_string();
                let prompt_text = if prompt.is_empty() {
                    format!("/{}", name)
                } else {
                    format!("/{}", name)
                };
                skills.push(SkillInfo {
                    name,
                    description,
                    prompt: prompt_text,
                });
            }
        }
    }

    skills
}

// --- Tauri commands ---

#[tauri::command]
pub fn scan_project_skills(project_dir: String) -> Result<Vec<SkillInfo>, String> {
    Ok(scan_skills(&project_dir))
}

#[tauri::command]
pub fn score_bookmarks(
    transcript_path: String,
    last_message: String,
    bookmarks_json: String,
) -> Result<HashMap<String, i64>, String> {
    let bookmarks: Vec<Bookmark> =
        serde_json::from_str(&bookmarks_json).map_err(|e| e.to_string())?;

    let signals = analyze_transcript(&transcript_path, &last_message);
    let tags = TAG_MAP.clone();

    let mut scores = HashMap::new();
    for bm in &bookmarks {
        let s = score_bookmark(bm, &signals.activity_patterns, &signals.keywords, &tags);
        scores.insert(bm.prompt.clone(), s);
    }

    Ok(scores)
}

#[tauri::command]
pub fn install_orbit_hooks(project_dir: String) -> Result<String, String> {
    let home = home_dir().ok_or("Impossible de trouver le repertoire home")?;
    let hooks_dir = home.join(".orbit").join("hooks");
    fs::create_dir_all(&hooks_dir).map_err(|e| e.to_string())?;

    // Copy stop hook script from resources or write inline
    let stop_hook_path = hooks_dir.join("orbit-stop-hook.sh");
    let _stop_hook_content = if cfg!(target_os = "windows") {
        // On Windows, write the .ps1 version
        let ps1_path = hooks_dir.join("orbit-stop-hook.ps1");
        let ps1 = r#"$input_data = [Console]::In.ReadToEnd()
$trigger = Join-Path $env:USERPROFILE ".orbit" "score-request.json"
[System.IO.File]::WriteAllText($trigger, $input_data)
"#;
        fs::write(&ps1_path, ps1).map_err(|e| e.to_string())?;
        // Also write the bash version for WSL
        let bash = "#!/bin/bash\nINPUT=$(cat)\nTRIGGER=\"$HOME/.orbit/score-request.json\"\necho \"$INPUT\" > \"$TRIGGER\"\n";
        fs::write(&stop_hook_path, bash).map_err(|e| e.to_string())?;
        ps1_path.to_string_lossy().to_string()
    } else {
        let bash = "#!/bin/bash\nINPUT=$(cat)\nTRIGGER=\"$HOME/.orbit/score-request.json\"\necho \"$INPUT\" > \"$TRIGGER\"\n";
        fs::write(&stop_hook_path, bash).map_err(|e| e.to_string())?;
        // Make executable on Unix
        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o755);
            fs::set_permissions(&stop_hook_path, perms).map_err(|e| e.to_string())?;
        }
        stop_hook_path.to_string_lossy().to_string()
    };

    // Write usage tracker
    let usage_hook_path = hooks_dir.join("orbit-track-usage.sh");
    let usage_script = r#"#!/bin/bash
INPUT=$(cat)
TOOL=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$TOOL" ] && exit 0
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"tool\":\"$TOOL\"}" >> "$HOME/.orbit/usage-log.jsonl"
# Log rotation — keep last 500 lines
LOG="$HOME/.orbit/usage-log.jsonl"
if [ -f "$LOG" ]; then
  LINES=$(wc -l < "$LOG")
  if [ "$LINES" -gt 1000 ]; then
    tail -500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
fi
"#;
    fs::write(&usage_hook_path, usage_script).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        fs::set_permissions(&usage_hook_path, perms).map_err(|e| e.to_string())?;
    }

    // Windows PowerShell usage tracker
    if cfg!(target_os = "windows") {
        let ps1_usage = hooks_dir.join("orbit-track-usage.ps1");
        let ps1_content = r#"$input_data = [Console]::In.ReadToEnd()
if ($input_data -match '"tool_name":"([^"]*)"') {
    $tool = $Matches[1]
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $line = "{`"ts`":`"$ts`",`"tool`":`"$tool`"}"
    $log = Join-Path $env:USERPROFILE ".orbit" "usage-log.jsonl"
    Add-Content -Path $log -Value $line
}
"#;
        fs::write(&ps1_usage, ps1_content).map_err(|e| e.to_string())?;
    }

    // Update .claude/settings.local.json in the project
    let settings_path = Path::new(&project_dir)
        .join(".claude")
        .join("settings.local.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        let raw = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))
    } else {
        if let Some(parent) = settings_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        serde_json::json!({})
    };

    let hooks = settings
        .as_object_mut()
        .ok_or("settings.local.json invalide")?
        .entry("hooks")
        .or_insert(serde_json::json!({}));
    let hooks_obj = hooks
        .as_object_mut()
        .ok_or("hooks invalide")?;

    // Determine hook command based on OS
    let stop_cmd = if cfg!(target_os = "windows") {
        format!(
            "powershell -ExecutionPolicy Bypass -File \"{}\"",
            hooks_dir.join("orbit-stop-hook.ps1").to_string_lossy()
        )
    } else {
        stop_hook_path.to_string_lossy().to_string()
    };

    let usage_cmd = if cfg!(target_os = "windows") {
        format!(
            "powershell -ExecutionPolicy Bypass -File \"{}\"",
            hooks_dir.join("orbit-track-usage.ps1").to_string_lossy()
        )
    } else {
        usage_hook_path.to_string_lossy().to_string()
    };

    // Add/replace Stop hook
    let stop_hooks = hooks_obj
        .entry("Stop")
        .or_insert(serde_json::json!([]));
    if let Some(arr) = stop_hooks.as_array_mut() {
        // Remove old skill-recommender hook if present
        arr.retain(|h| {
            let cmd = h.get("command").and_then(|v| v.as_str()).unwrap_or("");
            !cmd.contains("skill-recommender")
        });
        // Add orbit stop hook if not already present
        let has_orbit = arr.iter().any(|h| {
            let cmd = h.get("command").and_then(|v| v.as_str()).unwrap_or("");
            cmd.contains("orbit-stop-hook")
        });
        if !has_orbit {
            arr.push(serde_json::json!({
                "command": stop_cmd,
                "type": "command"
            }));
        }
    }

    // Add PostToolUse hook for usage tracking
    let post_hooks = hooks_obj
        .entry("PostToolUse")
        .or_insert(serde_json::json!([]));
    if let Some(arr) = post_hooks.as_array_mut() {
        // Remove old track-usage hook
        arr.retain(|h| {
            let cmd = h.get("command").and_then(|v| v.as_str()).unwrap_or("");
            !cmd.contains("track-usage")
        });
        let has_orbit = arr.iter().any(|h| {
            let cmd = h.get("command").and_then(|v| v.as_str()).unwrap_or("");
            cmd.contains("orbit-track-usage")
        });
        if !has_orbit {
            arr.push(serde_json::json!({
                "command": usage_cmd,
                "type": "command"
            }));
        }
    }

    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, json).map_err(|e| e.to_string())?;

    Ok("Hooks installes".to_string())
}

// --- Filesystem watcher ---

pub fn setup_watcher(app: tauri::AppHandle) -> Result<(), String> {
    use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
    use std::sync::mpsc;

    let home = home_dir().ok_or("Impossible de trouver le repertoire home")?;
    let orbit_dir = home.join(".orbit");

    // Ensure directory exists
    fs::create_dir_all(&orbit_dir).map_err(|e| e.to_string())?;

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = RecommendedWatcher::new(tx, Config::default()).map_err(|e| e.to_string())?;

    watcher
        .watch(&orbit_dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    let orbit_dir_clone = orbit_dir.clone();

    if let Err(e) = std::thread::Builder::new()
        .name("bookmark-watcher".into())
        .spawn(move || {
        // Keep watcher alive
        let _watcher = watcher;

        for event in rx {
            let Ok(event) = event else { continue };

            // Only react to Create/Modify events
            let is_relevant = matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_)
            );
            if !is_relevant {
                continue;
            }

            for path in &event.paths {
                let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                match filename {
                    "pending-bookmarks.json" => {
                        if let Ok(raw) = fs::read_to_string(path) {
                            if let Err(e) = fs::remove_file(path) {
                                tracing::warn!("Failed to remove {}: {e}", path.display());
                            }
                            let _ = app_handle.emit("bookmark-pending", raw);
                        }
                    }
                    "bookmark-scores.json" => {
                        if let Ok(raw) = fs::read_to_string(path) {
                            if let Err(e) = fs::remove_file(path) {
                                tracing::warn!("Failed to remove {}: {e}", path.display());
                            }
                            let _ = app_handle.emit("bookmark-scores", raw);
                        }
                    }
                    "score-request.json" => {
                        // Phase 4: stop hook wrote a score request — process it
                        if let Ok(raw) = fs::read_to_string(path) {
                            if let Err(e) = fs::remove_file(path) {
                                tracing::warn!("Failed to remove {}: {e}", path.display());
                            }
                            handle_score_request(&app_handle, &orbit_dir_clone, &raw);
                        }
                    }
                    "session-state.json" => {
                        // Event-driven session state detection (replaces frontend polling)
                        if let Ok(raw) = fs::read_to_string(path) {
                            let _ = app_handle.emit("session-state-changed", raw);
                        }
                    }
                    "statusline-latest.json" => {
                        // Event-driven statusline update (replaces frontend polling)
                        if let Ok(raw) = fs::read_to_string(path) {
                            let _ = app_handle.emit("statusline-updated", raw);
                        }
                    }
                    _ => {}
                }
            }
        }
    }) {
        tracing::error!("Failed to spawn bookmark watcher thread: {e}");
        return Err(format!("Failed to spawn watcher thread: {e}"));
    }

    Ok(())
}

fn handle_score_request(app: &tauri::AppHandle, orbit_dir: &Path, raw_input: &str) {
    // Parse the hook input
    #[derive(Deserialize)]
    struct HookInput {
        transcript_path: Option<String>,
        last_assistant_message: Option<String>,
    }

    let hook_data: HookInput = match serde_json::from_str(raw_input) {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("[bookmarks] Failed to parse hook input: {e}");
            return;
        }
    };

    // Load bookmarks from data.json
    let data_path = orbit_dir.join("data.json");
    let bookmarks: Vec<Bookmark> = if let Ok(raw) = fs::read_to_string(&data_path) {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&raw) {
            // Try active project bookmarks first
            let active_pid = data.get("activePid").and_then(|v| v.as_str()).unwrap_or("");
            data.get("projects")
                .and_then(|p| p.as_array())
                .and_then(|projects| {
                    projects.iter().find(|p| {
                        p.get("id").and_then(|v| v.as_str()).unwrap_or("") == active_pid
                    })
                })
                .and_then(|p| p.get("bookmarks"))
                .and_then(|b| serde_json::from_value(b.clone()).ok())
                .unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    if bookmarks.is_empty() {
        return;
    }

    let transcript = hook_data.transcript_path.unwrap_or_default();
    let last_msg = hook_data.last_assistant_message.unwrap_or_default();
    let signals = analyze_transcript(&transcript, &last_msg);
    let tags = TAG_MAP.clone();

    let mut scores: HashMap<String, i64> = HashMap::new();
    for bm in &bookmarks {
        scores.insert(
            bm.prompt.clone(),
            score_bookmark(bm, &signals.activity_patterns, &signals.keywords, &tags),
        );
    }

    // Emit scores to frontend
    if let Ok(json) = serde_json::to_string(&scores) {
        let _ = app.emit("bookmark-scores", json);
    }
}

// --- Helpers ---

fn home_dir() -> Option<PathBuf> {
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()
            .map(PathBuf::from)
    }
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keyword_extraction() {
        let patterns = &*KEYWORD_PATTERNS;
        let mut keywords = HashSet::new();
        extract_keywords("I need to fix the test suite and deploy to prod", &mut keywords, &patterns);
        assert!(keywords.contains("test"));
        assert!(keywords.contains("deploy"));
        assert!(keywords.contains("bug")); // "fix" matches bug pattern
    }

    #[test]
    fn test_score_bookmark() {
        let tags = TAG_MAP.clone();
        let mut activity = HashSet::new();
        activity.insert("code-writing".to_string());
        activity.insert("frontend-work".to_string());

        let mut keywords = HashSet::new();
        keywords.insert("frontend".to_string());

        let bm = Bookmark {
            id: "1".into(),
            name: "dev".into(),
            prompt: "/dev".into(),
            description: None,
        };

        let score = score_bookmark(&bm, &activity, &keywords, &tags);
        // "dev" matches TAG_MAP -> code-writing(+30), feature-impl(0), frontend-work(+30)
        assert!(score > 0);
    }

    #[test]
    fn test_parse_skill_frontmatter() {
        let content = "---\nname: my-skill\ndescription: Does something cool\n---\n\nSkill content here";
        let (name, desc) = parse_skill_frontmatter(content).unwrap();
        assert_eq!(name, "my-skill");
        assert_eq!(desc, "Does something cool");
    }

    #[test]
    fn test_parse_skill_frontmatter_no_name() {
        let content = "---\ndescription: No name\n---\ncontent";
        assert!(parse_skill_frontmatter(content).is_none());
    }

    #[test]
    fn test_extract_extension() {
        assert_eq!(extract_extension("src/App.tsx"), Some("tsx".into()));
        assert_eq!(extract_extension("Cargo.toml"), Some("toml".into()));
        assert_eq!(extract_extension("Makefile"), None);
    }
}
