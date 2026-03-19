use crate::validation::{validate_file_in_project, validate_project_dir};
use std::process::Command;

/// Get list of changed files (staged + unstaged).
#[tauri::command]
pub fn git_status(project_dir: String) -> Result<Vec<String>, String> {
    validate_project_dir(&project_dir)?;
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&project_dir)
        .output()
        .map_err(|e| format!("git status failed: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let files: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    Ok(files)
}

/// Get unified diff of all changes (staged + unstaged) against HEAD.
#[tauri::command]
pub fn git_diff(project_dir: String) -> Result<String, String> {
    validate_project_dir(&project_dir)?;
    let output = Command::new("git")
        .args(["diff", "HEAD"])
        .current_dir(&project_dir)
        .output()
        .map_err(|e| format!("git diff HEAD failed: {e}"))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Get diff for a specific file (staged + unstaged against HEAD).
#[tauri::command]
pub fn git_diff_file(project_dir: String, file_path: String) -> Result<String, String> {
    validate_project_dir(&project_dir)?;
    validate_file_in_project(&project_dir, &file_path)?;
    let output = Command::new("git")
        .args(["diff", "HEAD", "--", &file_path])
        .current_dir(&project_dir)
        .output()
        .map_err(|e| format!("git diff HEAD failed: {e}"))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Stage specific files and commit. If files is empty, stages only tracked modified files.
#[tauri::command]
pub fn git_commit(project_dir: String, message: String, files: Option<Vec<String>>) -> Result<String, String> {
    validate_project_dir(&project_dir)?;
    let add = match &files {
        Some(paths) if !paths.is_empty() => {
            // Validate file paths don't escape project directory
            for p in paths {
                validate_file_in_project(&project_dir, p)?;
            }
            let mut args = vec!["add", "--"];
            let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
            args.extend(path_refs);
            Command::new("git")
                .args(&args)
                .current_dir(&project_dir)
                .output()
                .map_err(|e| format!("git add failed: {e}"))?
        }
        _ => {
            // Default: stage only tracked modified files (not untracked)
            Command::new("git")
                .args(["add", "-u"])
                .current_dir(&project_dir)
                .output()
                .map_err(|e| format!("git add failed: {e}"))?
        }
    };

    if !add.status.success() {
        return Err(String::from_utf8_lossy(&add.stderr).to_string());
    }

    // Commit
    let commit = Command::new("git")
        .args(["commit", "-m", &message])
        .current_dir(&project_dir)
        .output()
        .map_err(|e| format!("git commit failed: {e}"))?;

    if !commit.status.success() {
        return Err(String::from_utf8_lossy(&commit.stderr).to_string());
    }

    // Return the commit SHA
    let sha = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(&project_dir)
        .output()
        .map_err(|e| format!("git rev-parse failed: {e}"))?;

    Ok(String::from_utf8_lossy(&sha.stdout).trim().to_string())
}

/// Push to remote.
#[tauri::command]
pub fn git_push(project_dir: String) -> Result<String, String> {
    validate_project_dir(&project_dir)?;
    let output = Command::new("git")
        .args(["push"])
        .current_dir(&project_dir)
        .output()
        .map_err(|e| format!("git push failed: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok("Push reussi".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Validation tests are in validation.rs

    fn git_status_rejects_invalid_dir() {
        let result = git_status("/nonexistent/dir/xyz".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn git_diff_rejects_invalid_dir() {
        let result = git_diff("/nonexistent/dir/xyz".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn git_diff_file_blocks_path_traversal() {
        let dir = std::env::temp_dir().join("orbit-test-git-diff");
        let _ = std::fs::create_dir_all(&dir);
        let result = git_diff_file(
            dir.to_str().unwrap().to_string(),
            "../../etc/passwd".to_string(),
        );
        assert!(result.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

