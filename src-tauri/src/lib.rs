mod commands;
mod db;
mod dirs;
mod indexer;
mod object_types;
mod periodic;
mod plugins;
mod watcher;

use std::sync::{Arc, Mutex};
use tauri::{Manager, Emitter};
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder};

pub struct AppState {
    pub directories: Mutex<dirs::DirectoryManager>,
    pub watcher: Mutex<Option<watcher::FileWatcher>>,
    pub db: Arc<Mutex<db::Database>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dir_manager = dirs::DirectoryManager::new().expect("Failed to initialize directory manager");

    // Initialize SQLite database at ~/.onyx/cache/index.db
    let db_path = dirs_next::home_dir()
        .expect("Could not find home directory")
        .join(".onyx")
        .join("cache")
        .join("index.db");

    let database = db::Database::new(&db_path).expect("Failed to initialize database");
    let db = Arc::new(Mutex::new(database));

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Build native menu bar
            // macOS: first submenu becomes the app menu. Add explicit one
            // so "File" doesn't get absorbed into it.
            let app_menu = SubmenuBuilder::new(app, "Onyx")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&MenuItemBuilder::with_id("new_note", "New Note").accelerator("CmdOrCtrl+N").build(app)?)
                .item(&MenuItemBuilder::with_id("quick_open", "Quick Open").accelerator("CmdOrCtrl+O").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("close_tab", "Close Tab").accelerator("CmdOrCtrl+W").build(app)?)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&MenuItemBuilder::with_id("find", "Find").accelerator("CmdOrCtrl+F").build(app)?)
                .item(&MenuItemBuilder::with_id("find_replace", "Find and Replace").accelerator("CmdOrCtrl+H").build(app)?)
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar").accelerator("CmdOrCtrl+Alt+[").build(app)?)
                .item(&MenuItemBuilder::with_id("toggle_context", "Toggle Context Panel").accelerator("CmdOrCtrl+Alt+]").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("command_palette", "Command Palette").accelerator("CmdOrCtrl+P").build(app)?)
                .build()?;

            let go_menu = SubmenuBuilder::new(app, "Go")
                .item(&MenuItemBuilder::with_id("today_note", "Today's Note").accelerator("CmdOrCtrl+Shift+D").build(app)?)
                .build()?;

            let format_menu = SubmenuBuilder::new(app, "Format")
                .item(&MenuItemBuilder::with_id("bold", "Bold").accelerator("CmdOrCtrl+B").build(app)?)
                .item(&MenuItemBuilder::with_id("italic", "Italic").accelerator("CmdOrCtrl+I").build(app)?)
                .item(&MenuItemBuilder::with_id("code", "Inline Code").accelerator("CmdOrCtrl+Shift+C").build(app)?)
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .fullscreen()
                .separator()
                .close_window()
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Help")
                .item(&MenuItemBuilder::with_id("about", "About Onyx").build(app)?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&go_menu)
                .item(&format_menu)
                .item(&window_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle menu events — emit to frontend for JS handling
            app.on_menu_event(|app_handle, event| {
                let _ = app_handle.emit("menu:action", event.id().0.as_str());
            });
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Start file watcher for registered directories
            let handle = app.handle().clone();
            let state = handle.state::<AppState>();
            let dirs = state.directories.lock().unwrap();
            let paths: Vec<_> = dirs.list().iter().map(|d| d.path.clone()).collect();
            let dir_pairs: Vec<(String, std::path::PathBuf)> = dirs
                .list()
                .iter()
                .map(|d| (d.id.clone(), d.path.clone()))
                .collect();
            drop(dirs);

            if !paths.is_empty() {
                // Start file watcher
                let db_ref = state.db.clone();
                let dir_pairs_for_watcher: Vec<(String, std::path::PathBuf)> = dir_pairs.clone();
                match watcher::FileWatcher::new(handle.clone(), &paths, db_ref, dir_pairs_for_watcher) {
                    Ok(fw) => {
                        let mut w = state.watcher.lock().unwrap();
                        *w = Some(fw);
                        log::info!("File watcher started for {} directories", paths.len());
                    }
                    Err(e) => log::error!("Failed to start file watcher: {}", e),
                }

                // Spawn background full index
                let db_ref = state.db.clone();
                let app_ref = handle.clone();
                std::thread::spawn(move || {
                    indexer::Indexer::full_scan(&dir_pairs, &db_ref, &app_ref);
                });
            }

            Ok(())
        })
        .manage(AppState {
            directories: Mutex::new(dir_manager),
            watcher: Mutex::new(None),
            db,
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::read_file,
            commands::write_file,
            commands::get_registered_directories,
            commands::register_directory,
            commands::unregister_directory,
            commands::search_files,
            commands::get_backlinks,
            commands::get_index_stats,
            commands::resolve_wikilink,
            commands::toggle_bookmark,
            commands::get_bookmarks,
            commands::is_file_bookmarked,
            commands::get_object_types,
            commands::query_by_type,
            commands::get_file_frontmatter,
            commands::update_frontmatter,
            commands::path_exists,
            commands::create_folder,
            commands::rename_file,
            commands::trash_file,
            commands::reveal_in_finder,
            commands::read_session,
            commands::write_session,
            commands::get_global_bookmarks,
            commands::toggle_global_bookmark,
            commands::is_global_bookmarked,
            commands::get_periodic_config,
            commands::save_periodic_config,
            commands::create_periodic_note,
            commands::get_dates_with_notes,
            commands::get_all_tags,
            commands::get_all_titles,
            commands::count_incoming_links,
            plugins::mac_rounded_corners::enable_rounded_corners,
            plugins::mac_rounded_corners::enable_modern_window_style,
            plugins::mac_rounded_corners::reposition_traffic_lights,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
