mod commands;
mod dirs;
mod watcher;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub directories: Mutex<dirs::DirectoryManager>,
    pub watcher: Mutex<Option<watcher::FileWatcher>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dir_manager = dirs::DirectoryManager::new().expect("Failed to initialize directory manager");

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
            drop(dirs);

            if !paths.is_empty() {
                match watcher::FileWatcher::new(handle.clone(), &paths) {
                    Ok(fw) => {
                        let mut w = state.watcher.lock().unwrap();
                        *w = Some(fw);
                        log::info!("File watcher started for {} directories", paths.len());
                    }
                    Err(e) => log::error!("Failed to start file watcher: {}", e),
                }
            }

            Ok(())
        })
        .manage(AppState {
            directories: Mutex::new(dir_manager),
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_directory,
            commands::read_file,
            commands::write_file,
            commands::get_registered_directories,
            commands::register_directory,
            commands::unregister_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
