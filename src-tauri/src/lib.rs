mod claude;
mod claude_sessions;
mod logging;
mod preview;
mod pty;
mod terminal;
mod validation;

#[cfg(target_os = "macos")]
use tauri::menu::AboutMetadata;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(pty::PtyState::new())
        .manage(preview::PreviewState::default())
        .menu(|app| {
            // --- App menu (macOS) / File menu (Windows/Linux) ---
            #[cfg(target_os = "macos")]
            let app_menu = Submenu::with_items(
                app,
                "Orbit",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(AboutMetadata::default()))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "preferences", "Preferences", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            #[cfg(not(target_os = "macos"))]
            let app_menu = Submenu::with_items(
                app,
                "Fichier",
                true,
                &[
                    &MenuItem::with_id(app, "preferences", "Preferences", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            // --- Edit menu ---
            let edit_menu = Submenu::with_items(
                app,
                "Edition",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;

            // --- View menu ---
            #[cfg(target_os = "macos")]
            let view_menu = Submenu::with_items(
                app,
                "Affichage",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?;

            #[cfg(not(target_os = "macos"))]
            let view_menu = Submenu::with_items(
                app,
                "Affichage",
                true,
                &[
                    &MenuItem::with_id(app, "zoom-in", "Zoom +", true, None::<&str>)?,
                    &MenuItem::with_id(app, "zoom-out", "Zoom -", true, None::<&str>)?,
                ],
            )?;

            Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu])
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            match id {
                "preferences" => {
                    let _ = app.emit("menu-event", "preferences");
                }
                "zoom-in" => {
                    let _ = app.emit("menu-event", "zoom-in");
                }
                "zoom-out" => {
                    let _ = app.emit("menu-event", "zoom-out");
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            preview::preview_list_files,
            preview::preview_read_file,
            preview::preview_pick_file,
            preview::preview_open_external,
            claude::check_claude_installed,
            claude::install_claude,
            claude::generate_title,
            claude::generate_session_title,
            claude_sessions::claude_sessions_snapshot,
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_pty,
            terminal::open_terminal,
            terminal::open_in_editor,
            terminal::save_scrollback,
            terminal::load_scrollback,
            terminal::notify_done,
            terminal::save_temp_image,
            terminal::create_directory,
            terminal::read_orbit_file,
            terminal::write_orbit_file,
            terminal::collect_crash_report,
            terminal::log_frontend,
        ])
        .setup(|_app| {
            logging::init();
            tracing::info!("Orbit starting");
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("Fatal error: {e}");
            std::process::exit(1);
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn shipping_resources_exclude_retired_hook_producers() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert!(config["bundle"].get("resources").is_none());
        assert!(config["bundle"]["icon"]
            .as_array()
            .is_some_and(|icons| !icons.is_empty()));
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        for retired in [
            "resources/orbit-session-hook.py",
            "resources/orbit-stop-hook.sh",
            "resources/orbit-stop-hook.ps1",
            "resources/orbit-track-usage.sh",
            "resources/statusline.sh",
            "src/watcher.rs",
            "src/statusline.rs",
            "../scripts/test_session_hook.py",
        ] {
            assert!(!root.join(retired).exists(), "retired producer: {retired}");
        }
    }

    #[test]
    fn production_registry_has_no_claude_config_mutators_or_legacy_watcher() {
        let production = include_str!("lib.rs").split("#[cfg(test)]").next().unwrap();
        let registry = production
            .split_once("tauri::generate_handler![")
            .unwrap()
            .1
            .split_once("])")
            .unwrap()
            .0;
        for retired in [
            "enable_session_hooks",
            "check_session_hooks",
            "remove_session_hooks",
            "create_statusline",
            "has_statusline",
            "enable_statusline",
            "check_statusline",
            "install_statusline",
            "remove_statusline",
        ] {
            assert!(
                !registry.contains(retired),
                "retired IPC command: {retired}"
            );
        }
        assert!(!production.contains("mod watcher;"));
        assert!(!production.contains("watcher::"));
        let claude = include_str!("claude.rs");
        assert!(!claude.contains("settings.local.json"));
        assert!(!claude.contains("std::fs::write"));
        assert!(!claude.contains("std::fs::create_dir"));
        for retained in [
            "claude::check_claude_installed",
            "claude::install_claude",
            "claude::generate_title",
            "claude::generate_session_title",
            "claude_sessions::claude_sessions_snapshot",
        ] {
            assert!(
                registry.contains(retained),
                "retained IPC command: {retained}"
            );
        }
    }
}
