use crate::AppState;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::State;

const IGNORED_NAMES: &[&str] = &[".obsidian", ".git", "node_modules", ".DS_Store", ".trash"];

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub extension: Option<String>,
}

fn validate_path(path: &PathBuf, state: &State<AppState>) -> Result<(), String> {
    let dirs = state.directories.lock().map_err(|e| e.to_string())?;
    // Try canonicalizing the full path first (works for existing files).
    // If that fails (new file), canonicalize the parent directory and append the filename.
    let canonical = path.canonicalize().or_else(|_| {
        let parent = path.parent().ok_or("Invalid file path")?;
        let name = path.file_name().ok_or("Invalid file name")?;
        parent.canonicalize()
            .map(|p| p.join(name))
            .map_err(|e| format!("Cannot resolve parent directory: {}", e))
    }).map_err(|e: String| e)?;

    if !dirs.is_path_allowed(&canonical) {
        return Err(format!("Access denied: path is not under a registered directory"));
    }
    Ok(())
}

#[tauri::command]
pub fn list_directory(path: String, state: State<AppState>) -> Result<Vec<DirEntry>, String> {
    let dir_path = PathBuf::from(&path);
    validate_path(&dir_path, &state)?;

    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries: Vec<DirEntry> = std::fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();

            if IGNORED_NAMES.contains(&name.as_str()) {
                return None;
            }

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

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        })
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String, state: State<AppState>) -> Result<String, String> {
    let file_path = PathBuf::from(&path);
    validate_path(&file_path, &state)?;

    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn write_file(path: String, content: String, state: State<AppState>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    validate_path(&target, &state)?;

    let dir = target.parent().ok_or("Invalid file path")?;
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_path = dir.join(format!(".onyx-tmp-{}-{}", std::process::id(), counter));

    std::fs::write(&temp_path, &content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Mark self-write BEFORE rename so the watcher suppresses the event
    {
        let watcher_lock = state.watcher.lock().map_err(|e| e.to_string())?;
        if let Some(ref fw) = *watcher_lock {
            fw.mark_self_write(&target);
        }
    }

    std::fs::rename(&temp_path, &target)
        .map_err(|e| {
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
    // Lock directories, register, then drop before acquiring watcher lock (#2: lock ordering)
    let dir = {
        let mut dirs = state.directories.lock().map_err(|e| e.to_string())?;
        dirs.register(PathBuf::from(path), label, color)?
    };

    // Now safe to lock watcher — directories lock is released
    let mut watcher_lock = state.watcher.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut fw) = *watcher_lock {
        fw.watch(&dir.path).map_err(|e| format!("Failed to watch directory: {}", e))?;
    } else {
        let dir_pairs = vec![(dir.id.clone(), dir.path.clone())];
        match crate::watcher::FileWatcher::new(app.clone(), &[dir.path.clone()], state.db.clone(), dir_pairs) {
            Ok(fw) => *watcher_lock = Some(fw),
            Err(e) => log::error!("Failed to start watcher: {}", e),
        }
    }
    drop(watcher_lock);

    // Trigger indexing of the new directory
    let dir_id = dir.id.clone();
    let dir_path = dir.path.clone();
    let db_ref = state.db.clone();
    let app_ref = app.clone();
    std::thread::spawn(move || {
        crate::indexer::Indexer::full_scan(&[(dir_id, dir_path)], &db_ref, &app_ref);
    });

    Ok(dir)
}

#[tauri::command]
pub fn unregister_directory(
    id: String,
    state: State<AppState>,
) -> Result<(), String> {
    let mut dirs = state.directories.lock().map_err(|e| e.to_string())?;
    dirs.unregister(&id)?;
    drop(dirs);

    // Remove indexed files for this directory (cascading deletes handle links/tags)
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_by_dir(&id)?;

    Ok(())
}

#[tauri::command]
pub fn search_files(
    query: String,
    state: State<AppState>,
) -> Result<Vec<crate::db::SearchResult>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.search_files(&query)
}

#[tauri::command]
pub fn get_backlinks(
    path: String,
    state: State<AppState>,
) -> Result<Vec<crate::db::BacklinkRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_backlinks(&path)
}

#[tauri::command]
pub fn get_index_stats(
    state: State<AppState>,
) -> Result<crate::db::IndexStats, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_stats()
}

#[tauri::command]
pub fn resolve_wikilink(
    link: String,
    context_path: String,
    state: State<AppState>,
) -> Result<Option<String>, String> {
    let context = PathBuf::from(&context_path);
    let context_dir = context.parent().map(PathBuf::from).unwrap_or_default();

    // Step 1: Exact path match — link contains '/', treat as relative path
    if link.contains('/') {
        let candidate = context_dir.join(format!("{}.md", link));
        if candidate.exists() {
            let canonical = candidate.canonicalize().map_err(|e| e.to_string())?;
            validate_path(&canonical, &state)?;
            return Ok(Some(canonical.to_string_lossy().to_string()));
        }
    }

    // Step 2: Same directory as context file
    let same_dir_candidate = context_dir.join(format!("{}.md", link));
    if same_dir_candidate.exists() {
        let canonical = same_dir_candidate.canonicalize().map_err(|e| e.to_string())?;
        validate_path(&canonical, &state)?;
        return Ok(Some(canonical.to_string_lossy().to_string()));
    }

    // Step 3: Query SQLite by title or filename (already in index = already validated)
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.resolve_by_title(&link)
}

#[tauri::command]
pub fn toggle_bookmark(
    path: String,
    state: State<AppState>,
) -> Result<bool, String> {
    let file_path = PathBuf::from(&path);
    validate_path(&file_path, &state)?;

    let db = state.db.lock().map_err(|e| e.to_string())?;

    let file_id = db.get_file_id(&path)?
        .ok_or_else(|| format!("File not indexed: {}", path))?;

    let currently_bookmarked = db.is_bookmarked(file_id)?;
    if currently_bookmarked {
        db.remove_bookmark(file_id)?;
        Ok(false)
    } else {
        db.add_bookmark(file_id, None, None)?;
        Ok(true)
    }
}

#[tauri::command]
pub fn get_bookmarks(
    state: State<AppState>,
) -> Result<Vec<crate::db::BookmarkRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_bookmarks()
}

#[tauri::command]
pub fn is_file_bookmarked(
    path: String,
    state: State<AppState>,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.is_path_bookmarked(&path)
}
