/// Centralized path validation utilities.
/// All path safety checks go through this module.

/// Validate a directory path contains no shell metacharacters or path traversal.
pub fn validate_dir(dir: &str) -> Result<(), String> {
    // Block path traversal components
    if dir.contains("..") {
        return Err("Chemin invalide (traversee de repertoire interdite)".to_string());
    }

    let dangerous = ['\'', '"', '`', '$', ';', '|', '&', '\n', '%', '^', '<', '>', '(', ')', '!'];
    #[cfg(not(target_os = "windows"))]
    let dangerous_with_backslash: Vec<char> = dangerous
        .iter()
        .copied()
        .chain(std::iter::once('\\'))
        .collect();
    #[cfg(not(target_os = "windows"))]
    let check_chars = &dangerous_with_backslash[..];
    #[cfg(target_os = "windows")]
    let check_chars = &dangerous[..];

    if dir.chars().any(|c| check_chars.contains(&c)) {
        return Err(format!(
            "Chemin invalide (caracteres speciaux non autorises) : {dir}"
        ));
    }
    Ok(())
}

/// Validate that a resolved path stays within a base directory (canonicalized).
pub fn validate_path_within(base_dir: &str, target: &str) -> Result<String, String> {
    let base = std::path::Path::new(base_dir)
        .canonicalize()
        .map_err(|e| format!("Repertoire base invalide : {e}"))?;

    let target_path = if std::path::Path::new(target).is_absolute() {
        std::path::PathBuf::from(target)
    } else {
        std::path::Path::new(base_dir).join(target)
    };

    // Canonicalize what exists, check prefix
    let mut check = target_path.clone();
    while !check.exists() {
        match check.parent() {
            Some(parent) => check = parent.to_path_buf(),
            None => return Err("Chemin invalide".to_string()),
        }
    }
    let canon = check
        .canonicalize()
        .map_err(|e| format!("Chemin invalide : {e}"))?;
    if !canon.starts_with(&base) {
        return Err("Chemin en dehors du repertoire autorise".to_string());
    }
    Ok(target_path.to_string_lossy().to_string())
}

/// Validate that project_dir is an existing directory.
#[allow(dead_code)]
pub fn validate_project_dir(dir: &str) -> Result<(), String> {
    if !std::path::Path::new(dir).is_dir() {
        return Err(format!("Repertoire projet introuvable : {dir}"));
    }
    Ok(())
}

/// Validate a session ID contains only safe characters.
pub fn validate_session_id(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("Session ID invalide : {id}"));
    }
    Ok(())
}

/// Validate a filename has no path traversal components.
pub fn validate_filename(name: &str) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Nom de fichier invalide".to_string());
    }
    Ok(())
}

/// Validate that a file path stays within the project directory (block path traversal).
#[allow(dead_code)]
pub fn validate_file_in_project(project_dir: &str, file_path: &str) -> Result<(), String> {
    if file_path.contains("..") {
        return Err("Chemin de fichier invalide".to_string());
    }
    let full = std::path::Path::new(project_dir).join(file_path);
    let canon_project = std::path::Path::new(project_dir)
        .canonicalize()
        .map_err(|e| format!("Repertoire projet invalide : {e}"))?;
    let mut check = full.clone();
    while !check.exists() {
        match check.parent() {
            Some(parent) => check = parent.to_path_buf(),
            None => break,
        }
    }
    if let Ok(canon_file) = check.canonicalize() {
        if !canon_file.starts_with(&canon_project) {
            return Err("Chemin de fichier invalide : en dehors du projet".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_dir_allows_normal_path() {
        assert!(validate_dir("/Users/test/project").is_ok());
    }

    #[test]
    fn validate_dir_blocks_semicolon() {
        assert!(validate_dir("/tmp; rm -rf /").is_err());
    }

    #[test]
    fn validate_dir_blocks_pipe() {
        assert!(validate_dir("/tmp | cat").is_err());
    }

    #[test]
    fn validate_dir_blocks_dollar() {
        assert!(validate_dir("/tmp/$HOME").is_err());
    }

    #[test]
    fn validate_dir_blocks_backtick() {
        assert!(validate_dir("/tmp/`whoami`").is_err());
    }

    #[test]
    fn validate_dir_blocks_dot_dot() {
        assert!(validate_dir("/tmp/../etc").is_err());
        assert!(validate_dir("../../secret").is_err());
    }

    #[test]
    fn validate_path_within_blocks_traversal() {
        let dir = std::env::temp_dir().join("orbit-test-path-within");
        let _ = std::fs::create_dir_all(&dir);
        assert!(validate_path_within(dir.to_str().unwrap(), "../../etc/passwd").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_path_within_allows_valid() {
        let dir = std::env::temp_dir().join("orbit-test-path-within2");
        let _ = std::fs::create_dir_all(&dir);
        assert!(validate_path_within(dir.to_str().unwrap(), "src/main.rs").is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_project_dir_rejects_nonexistent() {
        assert!(validate_project_dir("/nonexistent/path/abc123").is_err());
    }

    #[test]
    fn validate_project_dir_accepts_existing() {
        assert!(validate_project_dir("/tmp").is_ok());
    }

    #[test]
    fn validate_session_id_allows_uuid() {
        assert!(validate_session_id("abc-123-def").is_ok());
    }

    #[test]
    fn validate_session_id_rejects_empty() {
        assert!(validate_session_id("").is_err());
    }

    #[test]
    fn validate_session_id_rejects_slash() {
        assert!(validate_session_id("../etc/passwd").is_err());
    }

    #[test]
    fn validate_filename_rejects_traversal() {
        assert!(validate_filename("../etc/passwd").is_err());
        assert!(validate_filename("foo/bar.txt").is_err());
        assert!(validate_filename("foo\\bar.txt").is_err());
    }

    #[test]
    fn validate_filename_allows_normal() {
        assert!(validate_filename("data.json").is_ok());
        assert!(validate_filename("session-state.json").is_ok());
    }

    #[test]
    fn validate_file_in_project_blocks_traversal() {
        assert!(validate_file_in_project("/tmp", "../etc/passwd").is_err());
    }

    #[test]
    fn validate_file_in_project_allows_valid() {
        let dir = std::env::temp_dir().join("orbit-test-validation");
        let _ = std::fs::create_dir_all(&dir);
        assert!(validate_file_in_project(dir.to_str().unwrap(), "src/main.rs").is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
