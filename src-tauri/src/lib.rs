mod watcher;
mod claude;
mod logging;
mod pty;
mod statusline;
mod terminal;
mod validation;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu, AboutMetadata};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(pty::PtyState::new())
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
                &[
                    &PredefinedMenuItem::fullscreen(app, None)?,
                ],
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
            claude::check_claude_installed,
            claude::install_claude,
            claude::generate_title,
            claude::generate_session_title,
            claude::enable_session_hooks,
            claude::check_session_hooks,
            statusline::has_statusline,
            statusline::create_statusline,
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
        .setup(|app| {
            logging::init();
            tracing::info!("Orbit starting");
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = watcher::setup_watcher(handle) {
                    tracing::error!("watcher error: {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("Fatal error: {e}");
            std::process::exit(1);
        });
}
