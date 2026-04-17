use std::fs;
use std::path::PathBuf;
use tauri::Emitter;

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

    if let Err(e) = std::thread::Builder::new()
        .name("orbit-watcher".into())
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
                    "session-state.json" => {
                        if let Ok(raw) = fs::read_to_string(path) {
                            let _ = app_handle.emit("session-state-changed", raw);
                        }
                    }
                    "statusline-latest.json" => {
                        if let Ok(raw) = fs::read_to_string(path) {
                            let _ = app_handle.emit("statusline-updated", raw);
                        }
                    }
                    _ => {}
                }
            }
        }
    }) {
        tracing::error!("Failed to spawn orbit watcher thread: {e}");
        return Err(format!("Failed to spawn watcher thread: {e}"));
    }

    Ok(())
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
