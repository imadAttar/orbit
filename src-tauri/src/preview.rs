//! Read-only preview helpers. No caller-supplied directory is an authorization grant.
//!
//! Canonical containment rejects existing symlink escapes; picker grants authorize
//! only exact canonical file paths for this process lifetime. This is not a
//! sandbox against hostile concurrent filesystem mutation: std canonicalize,
//! metadata, and open are separate operations (TOCTOU). A local process able to
//! replace files/directories during these operations can race these checks.
//! Reads use an opened handle and a limit+1 cap, even if files grow while read.
//! Image MIME is extension-based; raster decoding is left to the WebView. SVG is
//! always UTF-8 source, never an image or executable document.
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub content: String,
    pub mime: String,
    pub modified_at: u64,
}

fn project_root(roots: &[PathBuf], project: &Path) -> Result<PathBuf, String> {
    if !project.is_absolute() {
        return Err("Projet absolu requis".into());
    }
    let root = project.canonicalize().map_err(|e| e.to_string())?;
    if !root.is_dir()
        || !roots
            .iter()
            .any(|r| r.is_absolute() && r.canonicalize().ok().as_ref() == Some(&root))
    {
        return Err("Projet non autorisé".into());
    }
    Ok(root)
}

fn checked_path(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if path.contains('\\')
        || path.chars().any(char::is_control)
        || p.components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Chemin non autorisé".into());
    }
    Ok(p)
}

fn resolve(
    roots: &[PathBuf],
    grants: &HashSet<PathBuf>,
    project: &Path,
    path: &str,
) -> Result<(PathBuf, String), String> {
    let p = checked_path(path)?;
    if p.is_absolute() {
        let target = p.canonicalize().map_err(|e| e.to_string())?;
        if grants.contains(&target) {
            return Ok((
                target.clone(),
                target.to_str().ok_or("Chemin non UTF-8")?.into(),
            ));
        }
    }
    let root = project_root(roots, project)?;
    let target = root.join(p).canonicalize().map_err(|e| e.to_string())?;
    let relative = target
        .strip_prefix(&root)
        .map_err(|_| "Chemin hors projet")?;
    let relative = relative
        .to_str()
        .ok_or("Chemin non UTF-8")?
        .replace('\\', "/");
    Ok((target, relative))
}

fn read_file(
    roots: &[PathBuf],
    grants: &HashSet<PathBuf>,
    project: &Path,
    path: &str,
) -> Result<PreviewFile, String> {
    let (target, relative) = resolve(roots, grants, project, path)?;
    use base64::Engine;
    use std::io::Read;
    let extension = target
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let image_mime = match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    };
    let limit = if image_mime.is_some() {
        12 * 1024 * 1024
    } else {
        2 * 1024 * 1024
    };
    if !target.is_file() {
        return Err("Fichier non régulier".into());
    }
    let file = std::fs::File::open(&target).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("Fichier non régulier ou trop volumineux".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("Fichier trop volumineux".into());
    }
    let content = if image_mime.is_some() {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    } else {
        let text = String::from_utf8(bytes).map_err(|_| "Fichier non UTF-8")?;
        if text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        {
            return Err("Fichier binaire".into());
        }
        text
    };
    let markdown = matches!(extension.as_str(), "md" | "markdown");
    Ok(PreviewFile {
        path: relative,
        name: target
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Nom non UTF-8")?
            .into(),
        kind: if image_mime.is_some() {
            "image"
        } else if markdown {
            "markdown"
        } else {
            "text"
        }
        .into(),
        mime: image_mime
            .unwrap_or(if markdown {
                "text/markdown"
            } else {
                "text/plain"
            })
            .into(),
        content,
        modified_at: metadata
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
            .min(9_007_199_254_740_991) as u64,
    })
}

#[derive(Debug, Serialize)]
pub struct PreviewEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
}
fn list_files(
    roots: &[PathBuf],
    project: &Path,
    relative: &str,
) -> Result<Vec<PreviewEntry>, String> {
    let root = project_root(roots, project)?;
    if checked_path(relative)?.is_absolute() {
        return Err("Chemin relatif requis".into());
    }
    let (directory, _) = resolve(roots, &HashSet::new(), project, relative)?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if checked_path(&name).is_err() {
            continue;
        }
        let Ok(canonical) = entry.path().canonicalize() else {
            continue;
        };
        if !canonical.starts_with(&root) {
            continue;
        }
        let Ok(metadata) = canonical.metadata() else {
            continue;
        };
        if !metadata.is_file() && !metadata.is_dir() {
            continue;
        }
        let Some(path) = entry
            .path()
            .strip_prefix(&root)
            .ok()
            .and_then(|p| p.to_str())
            .map(|p| p.replace('\\', "/"))
        else {
            continue;
        };
        entries.push(PreviewEntry {
            name,
            path,
            kind: if metadata.is_dir() {
                "directory"
            } else {
                "file"
            }
            .into(),
        });
        entries.sort_by(|a, b| {
            (a.kind != "directory", a.name.to_lowercase(), &a.name).cmp(&(
                b.kind != "directory",
                b.name.to_lowercase(),
                &b.name,
            ))
        });
        entries.truncate(300);
    }
    Ok(entries)
}

fn load_roots(home: &Path) -> Result<Vec<PathBuf>, String> {
    use std::io::Read;
    const LIMIT: u64 = 8 * 1024 * 1024;
    let file = std::fs::File::open(home.join(".orbit/data.json")).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > LIMIT {
        return Err("Configuration trop volumineuse".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("Configuration trop volumineuse".into());
    }
    let data: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let projects = data
        .get("projects")
        .and_then(|v| v.as_array())
        .ok_or("Configuration des projets invalide")?;
    Ok(projects
        .iter()
        .filter_map(|p| p.get("dir").and_then(|v| v.as_str()))
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .collect())
}

fn external_url(url: &str) -> Result<tauri::Url, String> {
    if url.trim() != url || url.chars().any(char::is_control) || url.contains('\\') {
        return Err("URL non autorisée".into());
    }
    // Reject encoded ASCII controls too; never pass them through to the OS opener.
    for part in url.as_bytes().windows(3) {
        if part[0] == b'%' {
            if let Ok(hex) = std::str::from_utf8(&part[1..]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    if byte < 32 || byte == 127 {
                        return Err("URL non autorisée".into());
                    }
                }
            }
        }
    }
    let parsed = tauri::Url::parse(url).map_err(|_| "URL invalide")?;
    let authority = url
        .split_once("://")
        .map(|(_, s)| s.split(['/', '?', '#']).next().unwrap_or(""));
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || authority.is_none_or(|a| a.is_empty() || a.contains('@'))
    {
        return Err("URL non autorisée".into());
    }
    Ok(parsed)
}

#[derive(Default)]
pub struct PreviewState {
    grants: std::sync::Mutex<HashSet<PathBuf>>,
}
impl PreviewState {
    fn grant(&self, path: &Path) -> Result<String, String> {
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        if !canonical.is_file() {
            return Err("Sélectionner un fichier régulier".into());
        }
        let result = canonical.to_str().ok_or("Chemin non UTF-8")?.to_owned();
        checked_path(&result)?;
        self.grants
            .lock()
            .map_err(|_| "État d’aperçu indisponible")?
            .insert(canonical);
        Ok(result)
    }
}
fn opener_command(url: &str) -> Result<std::process::Command, String> {
    let url = external_url(url)?;
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("/usr/bin/open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    command.arg(url.as_str());
    Ok(command)
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

fn require_local_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if local_main(window.label(), &window.url().map_err(|e| e.to_string())?) {
        Ok(())
    } else {
        Err("Aperçu réservé à la fenêtre locale".into())
    }
}

#[tauri::command]
pub async fn preview_list_files(
    window: tauri::WebviewWindow,
    project_dir: String,
    relative_path: Option<String>,
) -> Result<Vec<PreviewEntry>, String> {
    require_local_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let roots = load_roots(Path::new(&super::pty::home_dir()))?;
        list_files(
            &roots,
            Path::new(&project_dir),
            relative_path.as_deref().unwrap_or(""),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn preview_read_file(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, PreviewState>,
    project_dir: String,
    path: String,
) -> Result<PreviewFile, String> {
    require_local_main(&window)?;
    let grants = state
        .grants
        .lock()
        .map_err(|_| "État d’aperçu indisponible")?
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        // An unavailable/malformed settings file grants no project roots. Explicit
        // native-picker grants remain usable independently of settings loading.
        let roots = load_roots(Path::new(&super::pty::home_dir())).unwrap_or_default();
        read_file(&roots, &grants, Path::new(&project_dir), &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn preview_pick_file(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;
    require_local_main(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app.dialog().file().blocking_pick_file() else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        app.state::<PreviewState>().grant(&path).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn preview_open_external(
    window: tauri::WebviewWindow,
    url: String,
) -> Result<(), String> {
    require_local_main(&window)?;
    let mut command = opener_command(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        let status = command.status().map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Impossible d’ouvrir le navigateur".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "orbit-preview-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&root).unwrap();
            Self(root.canonicalize().unwrap())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn fixture_stays_within_configured_temp_dir() {
        let f = Fixture::new();
        let temp_dir = std::env::temp_dir().canonicalize().unwrap();
        assert!(
            f.0.starts_with(&temp_dir),
            "fixture {:?} is outside configured temp directory {:?}",
            f.0,
            temp_dir
        );
    }
    #[test]
    fn scope_blocks_traversal_symlink_escape_and_grants_only_exact_file() {
        let f = Fixture::new();
        let outside = Fixture::new();
        std::fs::write(outside.0.join("secret.txt"), "secret").unwrap();
        std::fs::write(outside.0.join("other.txt"), "other").unwrap();
        std::fs::create_dir(f.0.join("sub")).unwrap();
        std::fs::write(f.0.join("note.txt"), "ok").unwrap();
        let roots = [f.0.clone()];
        for path in ["sub/../note.txt", "../secret.txt"] {
            assert!(
                read_file(&roots, &HashSet::new(), &f.0, path).is_err(),
                "{path}"
            );
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outside.0.join("secret.txt"), f.0.join("escape")).unwrap();
            assert!(read_file(&roots, &HashSet::new(), &f.0, "escape").is_err());
        }
        let granted = outside.0.join("secret.txt");
        let grants = HashSet::from([granted.clone()]);
        assert_eq!(
            read_file(&[], &grants, Path::new(""), granted.to_str().unwrap())
                .unwrap()
                .content,
            "secret"
        );
        assert!(read_file(&[], &grants, &outside.0, "other.txt").is_err());
        assert!(read_file(
            &[],
            &grants,
            Path::new(""),
            outside.0.join("other.txt").to_str().unwrap()
        )
        .is_err());
    }
    #[test]
    fn text_reads_are_bounded_utf8_nonbinary_regular_files() {
        let f = Fixture::new();
        let roots = [f.0.clone()];
        for (name, bytes) in [
            ("bad.txt", vec![0xff]),
            ("nul.txt", b"a\0b".to_vec()),
            ("control.txt", vec![1, 2, 3]),
            ("large.txt", vec![b'a'; 2 * 1024 * 1024 + 1]),
        ] {
            std::fs::write(f.0.join(name), bytes).unwrap();
            assert!(
                read_file(&roots, &HashSet::new(), &f.0, name).is_err(),
                "{name}"
            );
        }
        std::fs::write(f.0.join("exact.txt"), vec![b'a'; 2 * 1024 * 1024]).unwrap();
        assert_eq!(
            read_file(&roots, &HashSet::new(), &f.0, "exact.txt")
                .unwrap()
                .content
                .len(),
            2 * 1024 * 1024
        );
        assert!(read_file(&roots, &HashSet::new(), &f.0, "").is_err());
        std::fs::write(f.0.join("icon.svg"), "<svg/> “texte”").unwrap();
        assert_eq!(
            read_file(&roots, &HashSet::new(), &f.0, "icon.svg")
                .unwrap()
                .kind,
            "text"
        );
    }
    #[test]
    fn raster_images_are_base64_with_bounded_size_and_svg_is_never_image() {
        let f = Fixture::new();
        for (ext, bytes, mime, encoded) in [
            (
                "PNG",
                b"\x89PNG\r\n\x1a\n".as_slice(),
                "image/png",
                "iVBORw0KGgo=",
            ),
            ("jpg", b"\xff\xd8\xff".as_slice(), "image/jpeg", "/9j/"),
            ("jpeg", b"\xff\xd8\xff".as_slice(), "image/jpeg", "/9j/"),
            ("gif", b"GIF89a".as_slice(), "image/gif", "R0lGODlh"),
            (
                "webp",
                b"RIFF1234WEBP".as_slice(),
                "image/webp",
                "UklGRjEyMzRXRUJQ",
            ),
            ("bmp", b"BM".as_slice(), "image/bmp", "Qk0="),
        ] {
            let name = format!("image.{ext}");
            std::fs::write(f.0.join(&name), bytes).unwrap();
            let r = read_file(std::slice::from_ref(&f.0), &HashSet::new(), &f.0, &name).unwrap();
            assert_eq!(
                (r.kind.as_str(), r.mime.as_str(), r.content.as_str()),
                ("image", mime, encoded)
            );
        }
        let big = std::fs::File::create(f.0.join("big.png")).unwrap();
        big.set_len(12 * 1024 * 1024 + 1).unwrap();
        assert!(read_file(std::slice::from_ref(&f.0), &HashSet::new(), &f.0, "big.png").is_err());
    }
    #[test]
    fn directory_listing_is_scoped_sorted_relative_and_capped() {
        let f = Fixture::new();
        std::fs::create_dir(f.0.join("zDir")).unwrap();
        std::fs::create_dir(f.0.join("ADir")).unwrap();
        for name in ["z.txt", "B.txt", "a.txt"] {
            std::fs::write(f.0.join(name), "x").unwrap();
        }
        let outside = Fixture::new();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside.0, f.0.join("escape")).unwrap();
        let roots = [f.0.clone()];
        let entries = list_files(&roots, &f.0, "").unwrap();
        assert_eq!(
            entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            ["ADir", "zDir", "a.txt", "B.txt", "z.txt"]
        );
        assert_eq!(entries[0].kind, "directory");
        std::fs::write(f.0.join("zDir/nested.txt"), "x").unwrap();
        assert_eq!(
            list_files(&roots, &f.0, "zDir").unwrap()[0].path,
            "zDir/nested.txt"
        );
        assert!(list_files(&[], &f.0, "").is_err());
        for path in ["../", "zDir/..", outside.0.to_str().unwrap()] {
            assert!(list_files(&roots, &f.0, path).is_err());
        }
        for i in 0..305 {
            std::fs::write(f.0.join(format!("file{i:03}.txt")), "").unwrap();
        }
        assert_eq!(list_files(&roots, &f.0, "").unwrap().len(), 300);
    }
    #[test]
    fn settings_scope_reads_only_registered_absolute_roots_and_fails_closed() {
        let f = Fixture::new();
        std::fs::create_dir(f.0.join(".orbit")).unwrap();
        let file = f.0.join(".orbit/data.json");
        std::fs::write(&file, serde_json::json!({"projects":[{"dir": f.0}, {"dir":"relative"}, {"dir":42}, {}], "arbitraryRoot":"/"}).to_string()).unwrap();
        assert_eq!(
            load_roots(&f.0).unwrap().as_slice(),
            std::slice::from_ref(&f.0)
        );
        for contents in ["{}", "{bad", "{\"projects\":null}"] {
            std::fs::write(&file, contents).unwrap();
            assert!(load_roots(&f.0).is_err());
        }
        std::fs::File::create(&file)
            .unwrap()
            .set_len(8 * 1024 * 1024 + 1)
            .unwrap();
        assert!(load_roots(&f.0).is_err());
    }
    #[test]
    fn external_urls_allow_only_http_https_without_credentials_or_controls() {
        for url in [
            "https://example.com/a?q=1#x",
            "http://localhost:3000/",
            "https://[::1]:8080/",
        ] {
            assert!(external_url(url).is_ok(), "{url}");
        }
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,x",
            "mailto:a@b.com",
            "--help",
            "https://user:pass@example.com",
            "https://user@example.com",
            "https://@example.com",
            "https://example.com\n",
            " https://example.com",
            "https://example.com/%0aevil",
            "https://example.com/%00",
            "http:///",
            "https:\\example.com",
        ] {
            assert!(external_url(url).is_err(), "{url:?}");
        }
    }
    #[test]
    fn picker_grant_is_canonical_exact_file_not_folder() {
        let f = Fixture::new();
        std::fs::write(f.0.join("chosen.txt"), "chosen").unwrap();
        let state = PreviewState::default();
        let chosen = state.grant(&f.0.join("chosen.txt")).unwrap();
        assert_eq!(chosen, f.0.join("chosen.txt").to_str().unwrap());
        assert_eq!(
            *state.grants.lock().unwrap(),
            HashSet::from([f.0.join("chosen.txt")])
        );
        assert!(state.grant(&f.0).is_err());
        assert!(state.grant(&f.0.join("missing")).is_err());
    }
    #[test]
    fn opener_constructs_arguments_without_launching_browser_or_shell() {
        let url = "https://example.com/?q=a%20b&x=;touch";
        let command = opener_command(url).unwrap();
        let args = command
            .get_args()
            .map(|s| s.to_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(args.last().copied(), Some(url));
        #[cfg(target_os = "macos")]
        assert_eq!(command.get_program(), "/usr/bin/open");
        #[cfg(target_os = "linux")]
        assert_eq!(command.get_program(), "xdg-open");
        #[cfg(target_os = "windows")]
        assert_eq!(command.get_program(), "rundll32.exe");
        assert!(opener_command("javascript:alert(1)").is_err());
    }
    #[test]
    fn only_local_main_window_can_use_preview_commands() {
        assert!(local_main(
            "main",
            &tauri::Url::parse("tauri://localhost/").unwrap()
        ));
        assert!(local_main(
            "main",
            &tauri::Url::parse("http://tauri.localhost/").unwrap()
        ));
        assert!(!local_main(
            "other",
            &tauri::Url::parse("tauri://localhost/").unwrap()
        ));
        for url in [
            "https://example.com",
            "https://localhost.evil/",
            "http://localhost:9999",
            "file:///tmp/x",
        ] {
            assert!(
                !local_main("main", &tauri::Url::parse(url).unwrap()),
                "{url}"
            );
        }
    }
    #[test]
    fn preview_ipc_is_registered_with_narrow_csp_and_local_only_capabilities() {
        let lib = include_str!("lib.rs");
        for command in [
            "preview_list_files",
            "preview_read_file",
            "preview_pick_file",
            "preview_open_external",
        ] {
            assert!(lib.contains(&format!("preview::{command}")), "{command}");
        }
        assert!(lib.contains(".manage(preview::PreviewState::default())"));
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = config["app"]["security"]["csp"].as_str().unwrap();
        assert!(csp.contains("frame-src http: https:"));
        assert!(
            csp.contains("frame-ancestors 'none'"),
            "remote previews must not embed the privileged Orbit UI"
        );
        let images = csp
            .split(';')
            .find(|s| s.trim_start().starts_with("img-src "))
            .unwrap();
        assert!(images.split_whitespace().any(|s| s == "data:"));
        assert!(!csp.contains("script-src *"));
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert!(capability.get("remote").is_none());
        assert_eq!(capability["windows"], serde_json::json!(["main"]));
    }
    #[cfg(unix)]
    #[test]
    fn fifo_is_rejected_before_open_can_block() {
        let f = Fixture::new();
        let fifo = f.0.join("pipe.txt");
        assert!(std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success());
        let root = f.0.clone();
        let (send, receive) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            send.send(read_file(
                std::slice::from_ref(&root),
                &HashSet::new(),
                &root,
                "pipe.txt",
            ))
            .unwrap();
        });
        let result = receive.recv_timeout(std::time::Duration::from_millis(200));
        if result.is_err() {
            // Release the blocked reader before failing, so no test worker leaks.
            let _release = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&fifo)
                .unwrap();
        }
        worker.join().unwrap();
        assert!(result.is_ok(), "preview blocked while opening FIFO");
        assert!(result.unwrap().is_err());
    }
    #[test]
    fn registered_project_reads_markdown_and_rejects_unregistered_root() {
        let f = Fixture::new();
        std::fs::write(f.0.join("note.md"), "# Bonjour").unwrap();
        let result =
            read_file(std::slice::from_ref(&f.0), &HashSet::new(), &f.0, "note.md").unwrap();
        assert_eq!(
            (
                result.path.as_str(),
                result.name.as_str(),
                result.kind.as_str(),
                result.mime.as_str(),
                result.content.as_str()
            ),
            (
                "note.md",
                "note.md",
                "markdown",
                "text/markdown",
                "# Bonjour"
            )
        );
        assert!(result.modified_at > 0 && result.modified_at <= 9_007_199_254_740_991);
        assert!(read_file(&[], &HashSet::new(), &f.0, "note.md").is_err());
    }
}
