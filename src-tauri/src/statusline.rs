use crate::pty::home_dir;

#[tauri::command]
pub fn has_statusline() -> bool {
    #[cfg(target_os = "windows")]
    { return true; }

    #[cfg(not(target_os = "windows"))]
    {
        let home = home_dir();
        if home.is_empty() { return true; }
        std::path::Path::new(&home).join(".claude/statusline.sh").exists()
    }
}

#[tauri::command]
pub fn create_statusline() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    { return Ok(()); }

    #[cfg(not(target_os = "windows"))]
    {
    let home = home_dir();
    if home.is_empty() { return Err("HOME not set".to_string()); }
    let path = std::path::Path::new(&home).join(".claude/statusline.sh");
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("[statusline] Failed to create directory: {e}");
        }
    }
    let script = include_str!("../resources/statusline.sh");
    std::fs::write(&path, script).map_err(|e| format!("Failed to write statusline: {}", e))?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("Failed to chmod statusline: {}", e))?;
    Ok(())
    }
}
