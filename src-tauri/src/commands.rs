use crate::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

const IGNORED_NAMES: &[&str] = &[".obsidian", ".git", "node_modules", ".DS_Store", ".trash"];

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub extension: Option<String>,
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let dir_path = PathBuf::from(&path);
    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries: Vec<DirEntry> = std::fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();

            // Filter ignored names
            if IGNORED_NAMES.contains(&name.as_str()) {
                return None;
            }

            // Skip hidden files (starting with .)
            if name.starts_with('.') {
                return None;
            }

            let path = entry.path();
            let is_dir = path.is_dir();
            let extension = if is_dir {
                None
            } else {
                path.extension().map(|e| e.to_string_lossy().to_string())
            };

            Some(DirEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                extension,
            })
        })
        .collect();

    // Sort: directories first, then alphabetical
    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        })
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    // Atomic write: write to temp file then rename
    let target = PathBuf::from(&path);
    let dir = target.parent().ok_or("Invalid file path")?;
    let temp_path = dir.join(format!(".onyx-tmp-{}", std::process::id()));

    std::fs::write(&temp_path, &content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    std::fs::rename(&temp_path, &target)
        .map_err(|e| {
            // Clean up temp file on rename failure
            let _ = std::fs::remove_file(&temp_path);
            format!("Failed to rename temp file: {}", e)
        })
}

#[tauri::command]
pub fn get_registered_directories(state: State<AppState>) -> Result<Vec<crate::dirs::RegisteredDirectory>, String> {
    let dirs = state.directories.lock().map_err(|e| e.to_string())?;
    Ok(dirs.list().to_vec())
}

#[tauri::command]
pub fn register_directory(
    path: String,
    label: String,
    color: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<crate::dirs::RegisteredDirectory, String> {
    let mut dirs = state.directories.lock().map_err(|e| e.to_string())?;
    let dir = dirs.register(PathBuf::from(path), label, color)?;

    // Start watching the new directory
    let mut watcher_lock = state.watcher.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut fw) = *watcher_lock {
        fw.watch(&dir.path).map_err(|e| format!("Failed to watch directory: {}", e))?;
    } else {
        match crate::watcher::FileWatcher::new(app, &[dir.path.clone()]) {
            Ok(fw) => *watcher_lock = Some(fw),
            Err(e) => log::error!("Failed to start watcher: {}", e),
        }
    }

    Ok(dir)
}

#[tauri::command]
pub fn unregister_directory(id: String, state: State<AppState>) -> Result<(), String> {
    let mut dirs = state.directories.lock().map_err(|e| e.to_string())?;
    dirs.unregister(&id)
}
