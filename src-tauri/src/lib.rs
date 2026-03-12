mod commands;
mod db;
mod dirs;
mod indexer;
mod object_types;
mod watcher;

use std::sync::{Arc, Mutex};
use tauri::Manager;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
