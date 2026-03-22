mod commands;
mod config;
mod db;
mod dirs;
mod indexer;
mod object_types;
mod paths;
mod periodic;
mod plugins;
mod watcher;

use std::sync::{Arc, Mutex};
use tauri::{Manager, Emitter};
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder};

/// Disable macOS App Nap to prevent throttling of JS timers when minimized.
/// Without this, auto-save (500ms debounce) and session persistence (30s interval) stall.
#[cfg(target_os = "macos")]
fn disable_app_nap() {
    use cocoa::base::{nil, id};
    use cocoa::foundation::NSString;
    use objc::{msg_send, sel, sel_impl};
    unsafe {
        let process_info: id = msg_send![
            objc::runtime::Class::get("NSProcessInfo").expect("NSProcessInfo class not found"),
            processInfo
        ];
        let reason = NSString::alloc(nil).init_str(
            "Onyx auto-save and session persistence timers must not be throttled",
        );
        // NSActivityUserInitiatedAllowingIdleSystemSleep = 0x00FFFFFF
        let _activity: id = msg_send![
            process_info,
            beginActivityWithOptions: 0x00FFFFFF_u64
            reason: reason
        ];
        // Activity is intentionally leaked — we want it active for the app's lifetime
    }
}

pub struct AppState {
    pub directories: Mutex<dirs::DirectoryManager>,
    pub watcher: Mutex<Option<watcher::FileWatcher>>,
    pub db: Arc<Mutex<db::Database>>,
    /// Tracks last-read mtime per file path to detect external modifications before write.
    /// Keys are canonical path strings for consistency.
    pub last_read_mtimes: Mutex<std::collections::HashMap<String, std::time::SystemTime>>,
    /// Paths explicitly allowed outside registered directories (orphan notes opened by the user)
    pub allowed_paths: Mutex<std::collections::HashSet<String>>,
    pub config: Mutex<config::Config>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dir_manager = dirs::DirectoryManager::new().expect("Failed to initialize directory manager");
    let app_config = config::load_config();

    // Initialize SQLite database at <onyx_dir>/cache/index.db
    let db_path = paths::onyx_dir()
        .expect("Could not resolve Onyx data directory")
        .join("cache")
        .join("index.db");

    let database = db::Database::new(&db_path).expect("Failed to initialize database");
    let db = Arc::new(Mutex::new(database));

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Build native menu bar
            // macOS: first submenu becomes the app menu. Add explicit one
            // so "File" doesn't get absorbed into it.
            let app_menu = SubmenuBuilder::new(app, "Onyx")
                .about(None)
                .separator()
                .item(&MenuItemBuilder::with_id("settings", "Settings…").accelerator("CmdOrCtrl+,").build(app)?)
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

                // Spawn background reconciliation (diffs disk vs DB, prunes stale entries)
                let db_ref = state.db.clone();
                let app_ref = handle.clone();
                std::thread::spawn(move || {
                    indexer::Indexer::reconcile(&dir_pairs, &db_ref, &app_ref);
                });
            }

            #[cfg(target_os = "macos")]
            disable_app_nap();

            Ok(())
        })
        .manage(AppState {
            directories: Mutex::new(dir_manager),
            watcher: Mutex::new(None),
            db,
            last_read_mtimes: Mutex::new(std::collections::HashMap::new()),
            allowed_paths: Mutex::new(std::collections::HashSet::new()),
            config: Mutex::new(app_config),
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::read_file,
            commands::write_file,
            commands::get_registered_directories,
            commands::register_directory,
            commands::unregister_directory,
            commands::update_directory_icon,
            commands::search_files,
            commands::search_content,
            commands::get_backlinks,
            commands::get_index_stats,
            commands::resolve_wikilink,
            commands::toggle_bookmark,
            commands::get_bookmarks,
            commands::is_file_bookmarked,
            commands::get_object_types,
            commands::save_object_types,
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
            commands::get_weeks_with_notes,
            commands::get_all_tags,
            commands::get_all_titles,
            commands::count_incoming_links,
            commands::allow_path,
            commands::disallow_path,
            commands::reindex_file,
            commands::get_config,
            commands::update_config,
            commands::get_keybindings,
            commands::save_keybindings,
            plugins::mac_rounded_corners::enable_rounded_corners,
            plugins::mac_rounded_corners::enable_modern_window_style,
            plugins::mac_rounded_corners::reposition_traffic_lights,
            commands::list_templates,
            commands::check_spelling,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
