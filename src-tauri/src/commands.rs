use crate::AppState;
use crate::watcher::FileChangeEvent;
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{Emitter, State};

use crate::object_types::{self, ObjectType};
use crate::periodic;

const IGNORED_NAMES: &[&str] = &[".obsidian", ".git", "node_modules", ".DS_Store", ".trash"];

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Atomic write + self-write mark + mtime update + reindex.
/// Shared by write_file and update_frontmatter.
fn commit_file(target: &PathBuf, content: &str, state: &State<AppState>) -> Result<(), String> {
    let dir = target.parent().ok_or("Invalid file path")?;
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_path = dir.join(format!(".onyx-tmp-{}-{}", std::process::id(), counter));

    std::fs::write(&temp_path, content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Mark self-write BEFORE rename so the watcher suppresses the event
    {
        let watcher_lock = state.watcher.lock().map_err(|e| e.to_string())?;
        if let Some(ref fw) = *watcher_lock {
            fw.mark_self_write(target);
        }
    }

    std::fs::rename(&temp_path, target)
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            format!("Failed to rename temp file: {}", e)
        })?;

    // Update mtime tracking after successful write (use canonical key)
    let canonical_key = target.canonicalize()
        .unwrap_or_else(|_| target.clone())
        .to_string_lossy().to_string();
    if let Ok(meta) = std::fs::metadata(target) {
        if let Ok(mtime) = meta.modified() {
            if let Ok(mut mtimes) = state.last_read_mtimes.lock() {
                mtimes.insert(canonical_key, mtime);
            }
        }
    }

    // Reindex immediately — watcher event is suppressed, so we must reindex here
    if target.extension().and_then(|e| e.to_str()) == Some("md") {
        let dirs = state.directories.lock().map_err(|e| e.to_string())?;
        let dir_id = dirs.list().iter().find_map(|d| {
            if target.starts_with(&d.path) { Some(d.id.clone()) } else { None }
        });
        drop(dirs);
        if let Some(id) = dir_id {
            let _ = crate::indexer::Indexer::reindex_file(target, &id, &state.db);
        }
    }

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub extension: Option<String>,
    /// Seconds since UNIX epoch (modified time)
    pub modified: Option<f64>,
    /// Seconds since UNIX epoch (created time)
    pub created: Option<f64>,
}

/// Canonicalize a path, falling back to canonicalizing the parent for new files.
fn canonical_path(path: &PathBuf) -> Result<PathBuf, String> {
    path.canonicalize().or_else(|_| {
        let parent = path.parent().ok_or("Invalid file path")?;
        let name = path.file_name().ok_or("Invalid file name")?;
        parent.canonicalize()
            .map(|p| p.join(name))
            .map_err(|e| format!("Cannot resolve parent directory: {}", e))
    }).map_err(|e: String| e)
}

fn validate_path(path: &PathBuf, state: &State<AppState>) -> Result<(), String> {
    let canonical = canonical_path(path)?;
    let dirs = state.directories.lock().map_err(|e| e.to_string())?;
    if dirs.is_path_allowed(&canonical) {
        return Ok(());
    }
    // Check orphan allowlist
    let allowed = state.allowed_paths.lock().map_err(|e| e.to_string())?;
    if allowed.contains(&canonical.to_string_lossy().to_string()) {
        return Ok(());
    }
    Err(format!("Access denied: path is not under a registered directory"))
}

/// Check if a directory contains any indexed .md files (via SQLite, not filesystem).
fn dir_has_markdown(path: &std::path::Path, db: &crate::db::Database) -> bool {
    db.has_files_under(&path.to_string_lossy())
}

#[tauri::command]
pub fn list_directory(path: String, sort_order: Option<String>, state: State<AppState>) -> Result<Vec<DirEntry>, String> {
    let dir_path = PathBuf::from(&path);
    validate_path(&dir_path, &state)?;

    if !dir_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let hide_empty = state.config.lock()
        .map(|c| c.behavior.hide_empty_folders)
        .unwrap_or(true);

    let db = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;

    let mut entries: Vec<DirEntry> = std::fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();

            if IGNORED_NAMES.contains(&name.as_str()) {
                return None;
            }

            if name.starts_with('.') && name != ".claude" {
                return None;
            }

            let path = entry.path();
            let is_dir = path.is_dir();

            // Only show directories and .md files
            if !is_dir && path.extension().and_then(|e| e.to_str()) != Some("md") {
                return None;
            }

            // Hide empty folders if setting is enabled
            if is_dir && hide_empty && !dir_has_markdown(&path, &db) {
                return None;
            }

            let extension = if is_dir {
                None
            } else {
                path.extension().map(|e| e.to_string_lossy().to_string())
            };

            // Read timestamps from metadata
            let meta = std::fs::metadata(&path).ok();
            let modified = meta.as_ref().and_then(|m| m.modified().ok()).map(|t| {
                t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
            });
            let created = meta.as_ref().and_then(|m| m.created().ok()).map(|t| {
                t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
            });

            Some(DirEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir,
                extension,
                modified,
                created,
            })
        })
        .collect();

    let sort = sort_order.as_deref().unwrap_or("name");
    entries.sort_by(|a, b| {
        // Directories always first
        b.is_dir.cmp(&a.is_dir).then_with(|| {
            match sort {
                "modified" => {
                    let am = a.modified.unwrap_or(0.0);
                    let bm = b.modified.unwrap_or(0.0);
                    bm.partial_cmp(&am).unwrap_or(std::cmp::Ordering::Equal)
                }
                "modified-asc" => {
                    let am = a.modified.unwrap_or(0.0);
                    let bm = b.modified.unwrap_or(0.0);
                    am.partial_cmp(&bm).unwrap_or(std::cmp::Ordering::Equal)
                }
                "created" => {
                    let ac = a.created.unwrap_or(0.0);
                    let bc = b.created.unwrap_or(0.0);
                    bc.partial_cmp(&ac).unwrap_or(std::cmp::Ordering::Equal)
                }
                "created-asc" => {
                    let ac = a.created.unwrap_or(0.0);
                    let bc = b.created.unwrap_or(0.0);
                    ac.partial_cmp(&bc).unwrap_or(std::cmp::Ordering::Equal)
                }
                "name-desc" => {
                    b.name.to_lowercase().cmp(&a.name.to_lowercase())
                }
                _ => {
                    a.name.to_lowercase().cmp(&b.name.to_lowercase())
                }
            }
        })
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String, state: State<AppState>) -> Result<String, String> {
    let file_path = PathBuf::from(&path);
    validate_path(&file_path, &state)?;

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Record mtime so write_file can detect external modifications.
    // Use canonical path as key for consistency (avoids symlink/trailing-slash mismatches).
    let canonical_key = file_path.canonicalize()
        .unwrap_or_else(|_| file_path.clone())
        .to_string_lossy().to_string();
    if let Ok(meta) = std::fs::metadata(&file_path) {
        if let Ok(mtime) = meta.modified() {
            let mut mtimes = state.last_read_mtimes.lock().map_err(|e| e.to_string())?;
            if mtimes.len() > 500 {
                // Evict oldest half instead of clearing everything
                let mut entries: Vec<_> = mtimes.iter().map(|(k, v)| (k.clone(), *v)).collect();
                entries.sort_by_key(|(_, t)| *t);
                let keep_from = entries.len() / 2;
                let evict: std::collections::HashSet<_> = entries[..keep_from].iter().map(|(k, _)| k.clone()).collect();
                mtimes.retain(|k, _| !evict.contains(k));
            }
            mtimes.insert(canonical_key, mtime);
        }
    }

    Ok(content)
}

#[tauri::command]
pub fn write_file(path: String, content: String, state: State<AppState>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    validate_path(&target, &state)?;

    // Use canonical path as mtime key for consistency with read_file
    let canonical_key = target.canonicalize()
        .unwrap_or_else(|_| target.clone())
        .to_string_lossy().to_string();

    // Combined no-op + mtime check. Uses mtime first to avoid expensive disk read on every auto-save.
    {
        let mut mtimes = state.last_read_mtimes.lock().map_err(|e| e.to_string())?;

        // Evict oldest half to prevent unbounded growth over long sessions
        if mtimes.len() > 500 {
            let mut entries: Vec<_> = mtimes.iter().map(|(k, v)| (k.clone(), *v)).collect();
            entries.sort_by_key(|(_, t)| *t);
            let keep_from = entries.len() / 2;
            let evict: std::collections::HashSet<_> = entries[..keep_from].iter().map(|(k, _)| k.clone()).collect();
            mtimes.retain(|k, _| !evict.contains(k));
        }

        if let Some(&last_known) = mtimes.get(&canonical_key) {
            if !target.exists() {
                return Err("DELETED:File no longer exists on disk.".to_string());
            }
            if let Ok(meta) = std::fs::metadata(&target) {
                if let Ok(current_mtime) = meta.modified() {
                    if current_mtime == last_known {
                        // mtime matches our last write — disk content is what we put there.
                        // JS side only triggers saves when content differs, so proceed to write.
                    } else {
                        return Err("CONFLICT:File was modified externally.".to_string());
                    }
                }
            }
        } else {
            // No mtime record (first save for this file) — fall back to content comparison
            drop(mtimes);
            if let Ok(existing) = std::fs::read_to_string(&target) {
                if existing == content {
                    return Ok(());
                }
            }
        }
    }

    commit_file(&target, &content, &state)
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

    // Trigger indexing of the new directory (reconcile handles add + prune)
    let dir_id = dir.id.clone();
    let dir_path = dir.path.clone();
    let db_ref = state.db.clone();
    let app_ref = app.clone();
    std::thread::spawn(move || {
        crate::indexer::Indexer::reconcile(&[(dir_id, dir_path)], &db_ref, &app_ref);
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
pub fn update_directory_icon(
    id: String,
    icon: String,
    state: State<AppState>,
) -> Result<(), String> {
    let mut dirs = state.directories.lock().map_err(|e| e.to_string())?;
    dirs.update_icon(&id, &icon)
}

#[tauri::command]
pub fn reorder_directories(
    ordered_ids: Vec<String>,
    state: State<AppState>,
) -> Result<(), String> {
    let mut dirs = state.directories.lock().map_err(|e| e.to_string())?;
    dirs.reorder(&ordered_ids)
}

#[tauri::command]
pub fn search_files(
    query: String,
    state: State<AppState>,
) -> Result<Vec<crate::db::SearchResult>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.search_files(&query)
}

// ── Full-text content search ──

#[derive(Debug, Serialize)]
pub struct LineMatch {
    pub line_number: u32,
    pub line_text: String,
}

#[derive(Debug, Serialize)]
pub struct ContentSearchResult {
    pub path: String,
    pub title: String,
    pub match_count: u32,
    pub title_match: bool,
    pub line_matches: Vec<LineMatch>,
}

#[tauri::command]
pub fn search_content(
    query: String,
    state: State<AppState>,
) -> Result<Vec<ContentSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let query_lower = query.to_lowercase();

    // Collect directory roots
    let dir_roots: Vec<PathBuf> = {
        let dirs = state.directories.lock().map_err(|e| e.to_string())?;
        dirs.list().iter().map(|d| d.path.clone()).collect()
    };

    // Collect orphan paths
    let orphan_paths: Vec<String> = {
        let allowed = state.allowed_paths.lock().map_err(|e| e.to_string())?;
        allowed.iter().cloned().collect()
    };

    let mut results: Vec<ContentSearchResult> = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    // Walk registered directories
    for root in &dir_roots {
        let walker = ignore::WalkBuilder::new(root)
            .hidden(true) // skip hidden files
            .build();

        for entry in walker.flatten() {
            let path = entry.path();
            if !path.is_file() { continue; }
            if path.extension().and_then(|e| e.to_str()) != Some("md") { continue; }

            let path_str = path.to_string_lossy().to_string();
            if !seen_paths.insert(path_str.clone()) { continue; }

            if let Some(result) = search_file(path, &path_str, &query_lower) {
                results.push(result);
            }
        }
    }

    // Search orphan files
    for orphan in &orphan_paths {
        let path = std::path::Path::new(orphan);
        if !path.is_file() { continue; }
        if path.extension().and_then(|e| e.to_str()) != Some("md") { continue; }
        if !seen_paths.insert(orphan.clone()) { continue; }

        if let Some(result) = search_file(path, orphan, &query_lower) {
            results.push(result);
        }
    }

    // Sort: title matches first (shorter title = better match), then by match count desc
    results.sort_by(|a, b| {
        b.title_match.cmp(&a.title_match)
            .then_with(|| {
                if a.title_match && b.title_match {
                    a.title.len().cmp(&b.title.len())
                } else {
                    b.match_count.cmp(&a.match_count)
                }
            })
    });

    results.truncate(500);
    Ok(results)
}

fn search_file(
    path: &std::path::Path,
    path_str: &str,
    query_lower: &str,
) -> Option<ContentSearchResult> {
    let title = path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    let title_match = title.to_lowercase().contains(query_lower);

    // Read file, skip if too large (>1MB) or binary
    let content = std::fs::read_to_string(path).ok()?;
    if content.len() > 1_048_576 { return None; }

    let mut line_matches: Vec<LineMatch> = Vec::new();
    let mut match_count: u32 = 0;

    for (i, line) in content.lines().enumerate() {
        let line_lower = line.to_lowercase();
        let hits = line_lower.matches(query_lower).count() as u32;
        if hits > 0 {
            match_count += hits;
            if line_matches.len() < 10 {
                let text = if line.len() > 200 {
                    // Find a char boundary at or before byte 200
                    let mut end = 200;
                    while !line.is_char_boundary(end) { end -= 1; }
                    format!("{}…", &line[..end])
                } else {
                    line.to_string()
                };
                line_matches.push(LineMatch {
                    line_number: (i + 1) as u32,
                    line_text: text,
                });
            }
        }
    }

    if !title_match && match_count == 0 {
        return None;
    }

    Some(ContentSearchResult {
        path: path_str.to_string(),
        title,
        match_count,
        title_match,
        line_matches,
    })
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

    // Normalise: strip .md suffix if present (avoid double .md)
    let base = link.strip_suffix(".md").unwrap_or(&link);

    // Step 1: Path with '/' — resolve relative to each registered directory root
    if base.contains('/') {
        let dirs = state.directories.lock().map_err(|e| e.to_string())?;
        for dir in dirs.list() {
            let candidate = dir.path.join(format!("{}.md", base));
            if candidate.exists() {
                let canonical = candidate.canonicalize().map_err(|e| e.to_string())?;
                return Ok(Some(canonical.to_string_lossy().to_string()));
            }
        }
    }

    // Step 2: Same directory as context file
    let same_dir_candidate = context_dir.join(format!("{}.md", base));
    if same_dir_candidate.exists() {
        let canonical = same_dir_candidate.canonicalize().map_err(|e| e.to_string())?;
        validate_path(&canonical, &state)?;
        return Ok(Some(canonical.to_string_lossy().to_string()));
    }

    // Step 3: Query SQLite by title or filename (already in index = already validated)
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.resolve_by_title(base)
}

// ── Unified Bookmarks (JSON-backed) ──

#[tauri::command]
pub fn toggle_bookmark(
    path: String,
    label: String,
    state: State<AppState>,
) -> Result<bool, String> {
    let mut bm = state.bookmarks.lock().map_err(|e| e.to_string())?;
    bm.toggle(&path, &label)
}

#[tauri::command]
pub fn get_bookmarks(
    state: State<AppState>,
) -> Result<Vec<crate::bookmarks::Bookmark>, String> {
    let bm = state.bookmarks.lock().map_err(|e| e.to_string())?;
    Ok(bm.list().to_vec())
}

#[tauri::command]
pub fn is_file_bookmarked(
    path: String,
    state: State<AppState>,
) -> Result<bool, String> {
    let bm = state.bookmarks.lock().map_err(|e| e.to_string())?;
    Ok(bm.is_bookmarked(&path))
}

#[tauri::command]
pub fn get_object_types() -> Result<Vec<ObjectType>, String> {
    object_types::load_object_types()
}

#[tauri::command]
pub fn save_object_types(json: String) -> Result<(), String> {
    let types: Vec<ObjectType> = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid object types JSON: {}", e))?;
    object_types::save_object_types(&types)
}

#[tauri::command]
pub fn query_by_type(
    type_name: String,
    state: State<AppState>,
) -> Result<Vec<crate::db::SearchResult>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.query_by_type(&type_name)
}

#[tauri::command]
pub fn get_file_frontmatter(
    path: String,
    state: State<AppState>,
) -> Result<Option<String>, String> {
    let file_path = PathBuf::from(&path);
    validate_path(&file_path, &state)?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_frontmatter(&path)
}

#[tauri::command]
pub fn update_frontmatter(
    path: String,
    frontmatter_json: String,
    state: State<AppState>,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    validate_path(&target, &state)?;

    // Parse the JSON into a serde value, then convert to YAML
    let value: serde_json::Value = serde_json::from_str(&frontmatter_json)
        .map_err(|e| format!("Invalid frontmatter JSON: {}", e))?;
    let yaml_str = serde_yaml_ng::to_string(&value)
        .map_err(|e| format!("Failed to convert frontmatter to YAML: {}", e))?;

    // Read existing file content
    let content = std::fs::read_to_string(&target)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Build new content: replace or prepend frontmatter
    let new_content = if content.trim_start().starts_with("---") {
        // Find the closing ---
        let trimmed = content.trim_start();
        let leading_whitespace = &content[..content.len() - trimmed.len()];
        let after_first = &trimmed[3..];
        if let Some(end) = after_first.find("\n---") {
            // Replace existing frontmatter
            let after_frontmatter = &after_first[end + 4..]; // skip \n---
            format!("{}---\n{}---{}", leading_whitespace, yaml_str, after_frontmatter)
        } else {
            // Malformed frontmatter (no closing ---), prepend new
            format!("---\n{}---\n\n{}", yaml_str, content)
        }
    } else {
        // No existing frontmatter, prepend
        format!("---\n{}---\n\n{}", yaml_str, content)
    };

    commit_file(&target, &new_content, &state)
}

#[tauri::command]
pub fn path_exists(path: String, state: State<AppState>) -> Result<bool, String> {
    let file_path = PathBuf::from(&path);
    validate_path(&file_path, &state).or_else(|_| {
        // For new paths, validate the parent instead
        let parent = file_path.parent().ok_or("Invalid path".to_string())?;
        validate_path(&parent.to_path_buf(), &state)
    })?;
    Ok(file_path.exists())
}

#[tauri::command]
pub fn create_folder(path: String, state: State<AppState>) -> Result<(), String> {
    let dir_path = PathBuf::from(&path);
    // Validate parent is under a registered directory
    let parent = dir_path.parent().ok_or("Invalid path")?;
    validate_path(&parent.to_path_buf(), &state)?;

    std::fs::create_dir_all(&dir_path)
        .map_err(|e| format!("Failed to create folder: {}", e))
}

#[tauri::command]
pub fn rename_file(
    old_path: String,
    new_path: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let old = PathBuf::from(&old_path);
    let new = PathBuf::from(&new_path);
    validate_path(&old, &state)?;
    validate_path(&new, &state)?;

    if new.exists() {
        return Err(format!("A file already exists at: {}", new_path));
    }

    // Mark self-write so watcher doesn't double-trigger
    {
        let watcher_lock = state.watcher.lock().map_err(|e| e.to_string())?;
        if let Some(ref fw) = *watcher_lock {
            fw.mark_self_write(&old);
            fw.mark_self_write(&new);
        }
    }

    let is_dir = old.is_dir();

    std::fs::rename(&old, &new)
        .map_err(|e| format!("Failed to rename: {}", e))?;

    // Update the index
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if is_dir {
        db.rename_dir_prefix(&old_path, &new_path)?;
    } else {
        db.rename_file(&old_path, &new_path)?;
    }
    drop(db);

    // Update bookmark paths
    if let Ok(mut bm) = state.bookmarks.lock() {
        if is_dir {
            let _ = bm.rename_prefix(&old_path, &new_path);
        } else {
            let _ = bm.rename_path(&old_path, &new_path);
        }
    }

    // Emit fs:change rename event before returning
    let _ = app.emit("fs:change", &FileChangeEvent {
        kind: "rename".to_string(),
        path: new_path,
        old_path: Some(old_path),
        is_dir,
    });

    Ok(())
}

#[tauri::command]
pub fn trash_file(path: String, state: State<AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    validate_path(&file_path, &state)?;

    let is_dir = file_path.is_dir();

    trash::delete(&file_path)
        .map_err(|e| format!("Failed to move to trash: {}", e))?;

    // Remove from index
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if is_dir {
        db.delete_by_prefix(&path)?;
    } else {
        db.delete_file(&path)?;
    }
    drop(db);

    // Remove bookmark for deleted file
    if let Ok(mut bm) = state.bookmarks.lock() {
        let _ = bm.remove_path(&path);
    }

    // Emit fs:change remove event before returning
    let _ = app.emit("fs:change", &FileChangeEvent {
        kind: "remove".to_string(),
        path,
        old_path: None,
        is_dir,
    });

    Ok(())
}

#[tauri::command]
pub fn reveal_in_finder(path: String, state: State<AppState>) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    validate_path(&file_path, &state)?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Open the parent directory
        let parent = file_path.parent().unwrap_or(&file_path);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal in Explorer: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn read_session() -> Result<Option<String>, String> {
    let path = crate::paths::onyx_dir()?.join("session.json");

    if !path.exists() {
        return Ok(None);
    }

    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read session.json: {}", e))
}

#[tauri::command]
pub fn write_session(json: String) -> Result<(), String> {
    let dir = crate::paths::onyx_dir()?;

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create ~/.onyx: {}", e))?;

    let path = dir.join("session.json");
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_path = dir.join(format!(".session-tmp-{}-{}", std::process::id(), counter));

    std::fs::write(&temp_path, &json)
        .map_err(|e| format!("Failed to write session temp file: {}", e))?;

    std::fs::rename(&temp_path, &path)
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            format!("Failed to rename session temp file: {}", e)
        })
}

// ── Global Bookmarks ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalBookmark {
    pub path: String,
    pub label: String,
}

fn global_bookmarks_path() -> Result<PathBuf, String> {
    Ok(crate::paths::onyx_dir()?.join("global-bookmarks.json"))
}

/// Read legacy global bookmarks for migration. Public for lib.rs.
pub fn read_legacy_global_bookmarks() -> Result<Vec<(String, String)>, String> {
    let path = global_bookmarks_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read global-bookmarks.json: {}", e))?;
    let bookmarks: Vec<GlobalBookmark> = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse global-bookmarks.json: {}", e))?;
    Ok(bookmarks.into_iter().map(|b| (b.path, b.label)).collect())
}

// ── Autocomplete & Metadata ──

#[tauri::command]
pub fn get_all_tags(
    state: State<AppState>,
) -> Result<Vec<crate::db::TagInfo>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_tags()
}

#[tauri::command]
pub fn get_all_titles(
    state: State<AppState>,
) -> Result<Vec<crate::db::SearchResult>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_titles()
}

#[tauri::command]
pub fn count_incoming_links(
    path: String,
    state: State<AppState>,
) -> Result<u32, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.count_incoming_links(&path)
}

fn days_in_month_count(year: i32, month: u32) -> u32 {
    if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .and_then(|d| d.pred_opt())
    .map(|d| d.day())
    .unwrap_or(30)
}

// ── Periodic Notes ──

#[derive(Debug, Serialize)]
pub struct CreatePeriodicNoteResult {
    pub path: String,
    pub created: bool,
    pub cursor_offset: Option<usize>,
}

#[tauri::command]
pub fn get_periodic_config() -> Result<periodic::PeriodicConfig, String> {
    periodic::load_config()
}

#[tauri::command]
pub fn save_periodic_config(config: periodic::PeriodicConfig) -> Result<(), String> {
    periodic::save_config(&config)
}

#[tauri::command]
pub fn create_periodic_note(
    period_type: String,
    date: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<CreatePeriodicNoteResult, String> {
    // Accept YYYY-MM-DD or YYYY-Www (ISO week → Monday of that week)
    let parsed_date = if date.contains("-W") {
        let parts: Vec<&str> = date.splitn(2, "-W").collect();
        let year: i32 = parts[0].parse().map_err(|_| format!("Invalid week date '{}'", date))?;
        let week: u32 = parts[1].parse().map_err(|_| format!("Invalid week date '{}'", date))?;
        NaiveDate::from_isoywd_opt(year, week, chrono::Weekday::Mon)
            .ok_or_else(|| format!("Invalid ISO week: {}", date))?
    } else {
        NaiveDate::parse_from_str(&date, "%Y-%m-%d")
            .map_err(|e| format!("Invalid date '{}': {}", date, e))?
    };

    let config = periodic::load_config()?;

    let period_config = match period_type.as_str() {
        "daily" => config.daily,
        "weekly" => config.weekly,
        "monthly" => config.monthly,
        _ => return Err(format!("Unknown period type: {}", period_type)),
    }
    .ok_or_else(|| format!("{} notes not configured", period_type))?;

    if !period_config.enabled {
        return Err(format!("{} notes are not enabled", period_type));
    }

    if period_config.directory_id.is_empty() {
        return Err("Periodic notes not configured — please set a directory".to_string());
    }

    // Look up the registered directory
    let dirs = state.directories.lock().map_err(|e| e.to_string())?;
    let dir = dirs
        .list()
        .iter()
        .find(|d| d.id == period_config.directory_id)
        .ok_or_else(|| "Configured directory not found — it may have been removed".to_string())?;

    let dir_id = dir.id.clone();
    let dir_path = dir.path.clone();
    drop(dirs);

    let (relative_path, title) = periodic::generate_note_path(&period_config.format, parsed_date);
    let full_path = dir_path.join(&relative_path);

    // If file already exists, just return the path
    if full_path.exists() {
        return Ok(CreatePeriodicNoteResult {
            path: full_path.to_string_lossy().to_string(),
            created: false,
            cursor_offset: None,
        });
    }

    // Create parent directories
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    // Read template if configured
    let (content, cursor_offset) = if let Some(ref template_path) = period_config.template {
        let template_full_path = dir_path.join(template_path);
        if template_full_path.exists() {
            let template_content = std::fs::read_to_string(&template_full_path)
                .map_err(|e| format!("Failed to read template: {}", e))?;
            periodic::render_template(&template_content, parsed_date, &title, &full_path)?
        } else {
            // Template doesn't exist — create with minimal default
            (format!("# {}\n\n", title), None)
        }
    } else {
        (format!("# {}\n\n", title), None)
    };

    // Atomic write
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_path = full_path
        .parent()
        .unwrap()
        .join(format!(".onyx-tmp-{}-{}", std::process::id(), counter));

    std::fs::write(&temp_path, &content)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Mark self-write before rename
    {
        let watcher_lock = state.watcher.lock().map_err(|e| e.to_string())?;
        if let Some(ref fw) = *watcher_lock {
            fw.mark_self_write(&full_path);
        }
    }

    std::fs::rename(&temp_path, &full_path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to create periodic note: {}", e)
    })?;

    // Full reindex so frontmatter, links, and tags are extracted immediately
    let path_str = full_path.to_string_lossy().to_string();
    let _ = crate::indexer::Indexer::reindex_file(&full_path, &dir_id, &state.db);

    // Emit fs:change create event before returning
    let _ = app.emit("fs:change", &FileChangeEvent {
        kind: "create".to_string(),
        path: path_str.clone(),
        old_path: None,
        is_dir: false,
    });

    Ok(CreatePeriodicNoteResult {
        path: path_str,
        created: true,
        cursor_offset,
    })
}

#[tauri::command]
pub fn get_dates_with_notes(
    year: i32,
    month: u32,
    state: State<AppState>,
) -> Result<Vec<u32>, String> {
    let config = periodic::load_config()?;

    let daily_config = match &config.daily {
        Some(c) if c.enabled && !c.directory_id.is_empty() => c,
        _ => return Ok(Vec::new()),
    };

    // Look up the directory path
    let dirs = state.directories.lock().map_err(|e| e.to_string())?;
    let dir = match dirs.list().iter().find(|d| d.id == daily_config.directory_id) {
        Some(d) => d,
        None => return Ok(Vec::new()),
    };

    let dir_path = dir.path.to_string_lossy().to_string();
    drop(dirs);

    // Generate expected paths for each day and check against indexed files
    let days_in_month = days_in_month_count(year, month);
    let mut days = Vec::new();

    let db = state.db.lock().map_err(|e| e.to_string())?;
    for day in 1..=days_in_month {
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
            let (relative, _) = periodic::generate_note_path(&daily_config.format, date);
            let full_path = format!("{}/{}", dir_path, relative);
            if let Ok(Some(_)) = db.get_file_id(&full_path) {
                days.push(day);
            }
        }
    }
    Ok(days)
}

#[tauri::command]
pub fn get_weeks_with_notes(
    weeks: Vec<String>,
    state: State<AppState>,
) -> Result<Vec<String>, String> {
    let config = periodic::load_config()?;

    let weekly_config = match &config.weekly {
        Some(c) if c.enabled && !c.directory_id.is_empty() => c,
        _ => return Ok(Vec::new()),
    };

    let dirs = state.directories.lock().map_err(|e| e.to_string())?;
    let dir = match dirs.list().iter().find(|d| d.id == weekly_config.directory_id) {
        Some(d) => d,
        None => return Ok(Vec::new()),
    };

    let dir_path = dir.path.to_string_lossy().to_string();
    drop(dirs);

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut found = Vec::new();

    for week_str in &weeks {
        // Parse YYYY-Www → Monday of that week
        if let Some(date) = parse_week_string(week_str) {
            let (relative, _) = periodic::generate_note_path(&weekly_config.format, date);
            let full_path = format!("{}/{}", dir_path, relative);
            if let Ok(Some(_)) = db.get_file_id(&full_path) {
                found.push(week_str.clone());
            }
        }
    }
    Ok(found)
}

fn parse_week_string(s: &str) -> Option<NaiveDate> {
    let parts: Vec<&str> = s.splitn(2, "-W").collect();
    if parts.len() != 2 { return None; }
    let year: i32 = parts[0].parse().ok()?;
    let week: u32 = parts[1].parse().ok()?;
    NaiveDate::from_isoywd_opt(year, week, chrono::Weekday::Mon)
}

/// Allow a path outside registered directories (for orphan notes opened by the user).
#[tauri::command]
pub fn allow_path(path: String, state: State<AppState>) -> Result<(), String> {
    let canonical = canonical_path(&PathBuf::from(&path))?;
    let canonical_str = canonical.to_string_lossy().to_string();

    // Block known-dangerous paths
    const BLOCKED_PREFIXES: &[&str] = &[
        "/etc", "/var", "/usr", "/bin", "/sbin", "/System", "/Library",
        "/private/etc", "/private/var",
    ];
    let home = dirs_next::home_dir().unwrap_or_default();
    let blocked_home: Vec<PathBuf> = [".ssh", ".gnupg", ".aws", ".config/gcloud", ".kube"]
        .iter().map(|s| home.join(s)).collect();

    for prefix in BLOCKED_PREFIXES {
        if canonical_str.starts_with(prefix) {
            return Err(format!("Access denied: {}", path));
        }
    }
    for blocked in &blocked_home {
        if canonical.starts_with(blocked) {
            return Err(format!("Access denied: {}", path));
        }
    }

    let mut allowed = state.allowed_paths.lock().map_err(|e| e.to_string())?;
    allowed.insert(canonical_str);
    Ok(())
}

/// Remove a path from the orphan allowlist.
#[tauri::command]
pub fn disallow_path(path: String, state: State<AppState>) -> Result<(), String> {
    let canonical = canonical_path(&PathBuf::from(&path))?;
    let mut allowed = state.allowed_paths.lock().map_err(|e| e.to_string())?;
    allowed.remove(&canonical.to_string_lossy().to_string());
    Ok(())
}

// ── Reindex ──

#[tauri::command]
pub fn reindex_file(path: String, state: State<AppState>) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    validate_path(&file_path, &state)?;
    let dirs = state.directories.lock().map_err(|e| e.to_string())?;
    let dir_id = dirs.list().iter()
        .find(|d| file_path.starts_with(&d.path))
        .map(|d| d.id.clone())
        .unwrap_or_default();
    drop(dirs);
    crate::indexer::Indexer::reindex_file(&file_path, &dir_id, &state.db)
}

// ── Config ──

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Result<crate::config::Config, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
pub fn update_config(json: String, state: State<AppState>) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    let updated = crate::config::update_config(&config, &json)?;
    *config = updated;
    Ok(())
}

#[tauri::command]
pub fn get_keybindings() -> Result<Vec<crate::config::KeyBinding>, String> {
    crate::config::load_keybindings()
}

#[tauri::command]
pub fn save_keybindings(json: String) -> Result<(), String> {
    let bindings: Vec<crate::config::KeyBinding> = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid keybindings JSON: {}", e))?;
    crate::config::save_keybindings(&bindings)
}

// ── Templates ──

#[derive(Debug, Serialize)]
pub struct TemplateEntry {
    pub name: String,
    pub content: String,
}

#[tauri::command]
pub fn list_templates(state: State<AppState>) -> Result<Vec<TemplateEntry>, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let mut entries = Vec::new();

    for dir in &config.behavior.template_dirs {
        let dir_path = std::path::Path::new(dir);
        if !dir_path.is_dir() { continue; }

        if let Ok(read_dir) = std::fs::read_dir(dir_path) {
            for entry in read_dir.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            entries.push(TemplateEntry {
                                name: name.to_string(),
                                content,
                            });
                        }
                    }
                }
            }
        }
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

// ── Spellcheck (macOS only) ──

#[derive(Debug, Serialize)]
pub struct SpellingError {
    pub from: usize,
    pub to: usize,
    pub word: String,
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn check_spelling(text: String) -> Vec<SpellingError> {
    use cocoa::base::nil;
    use cocoa::foundation::NSString;
    use objc::{msg_send, sel, sel_impl, runtime::Class};

    let mut errors = Vec::new();

    unsafe {
        let checker: cocoa::base::id = msg_send![
            Class::get("NSSpellChecker").unwrap(),
            sharedSpellChecker
        ];
        let ns_text = NSString::alloc(nil).init_str(&text);
        let text_len: usize = msg_send![ns_text, length]; // UTF-16 length

        let mut offset: usize = 0;
        while offset < text_len {
            let range: cocoa::foundation::NSRange = msg_send![
                checker,
                checkSpellingOfString: ns_text
                startingAt: offset as cocoa::foundation::NSInteger
                language: nil
                wrap: false
                inSpellDocumentWithTag: 0i64
                wordCount: std::ptr::null_mut::<cocoa::foundation::NSInteger>()
            ];

            if range.length == 0 {
                break;
            }

            // Extract the misspelled word
            let sub: cocoa::base::id = msg_send![ns_text, substringWithRange: range];
            let cstr: *const std::os::raw::c_char = msg_send![sub, UTF8String];
            let word = std::ffi::CStr::from_ptr(cstr).to_string_lossy().to_string();

            // Return UTF-16 offsets directly — JS string indexing is UTF-16 based
            let from = range.location as usize;
            let to = (range.location + range.length) as usize;

            errors.push(SpellingError {
                from,
                to,
                word,
            });

            offset = (range.location + range.length) as usize;
        }
    }

    errors
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn check_spelling(_text: String) -> Vec<SpellingError> {
    Vec::new()
}

/// Trigger the native print dialog for the current webview.
#[tauri::command]
pub fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Drain any files buffered from Finder "Open With" before frontend was ready.
#[tauri::command]
pub fn drain_pending_open_files(state: State<AppState>) -> Vec<String> {
    let mut pending = state.pending_open_files.lock().unwrap();
    pending.drain(..).collect()
}

// ── Folder rules ──

#[tauri::command]
pub fn get_folder_rules() -> Result<crate::folder_rules::FolderRulesConfig, String> {
    crate::folder_rules::load_config()
}

#[tauri::command]
pub fn save_folder_rules(config: crate::folder_rules::FolderRulesConfig) -> Result<(), String> {
    crate::folder_rules::save_config(&config)
}

// ── Scripts ──

#[tauri::command]
pub fn list_scripts() -> Result<Vec<crate::scripts::ScriptInfo>, String> {
    crate::scripts::list_scripts()
}

#[derive(serde::Serialize)]
pub struct ScriptRunResult {
    pub stdout: String,
}

#[tauri::command]
pub fn run_script(
    name: String,
    args: Vec<String>,
    file_path: Option<String>,
) -> Result<ScriptRunResult, String> {
    let info = crate::scripts::find_script(&name)?;

    let mut env = std::collections::HashMap::new();
    if let Some(ref p) = file_path {
        env.insert("ONYX_NOTE_PATH".to_string(), p.clone());
        let path = std::path::Path::new(p);
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            env.insert("ONYX_NOTE_TITLE".to_string(), stem.to_string());
        }
        if let Some(parent) = path.parent().and_then(|s| s.to_str()) {
            env.insert("ONYX_NOTE_DIR".to_string(), parent.to_string());
        }
    }
    let today = chrono::Local::now().date_naive();
    env.insert(
        "ONYX_NOTE_DATE".to_string(),
        today.format("%Y-%m-%d").to_string(),
    );

    let stdout = crate::scripts::run_script(&info, &args, &env)?;
    Ok(ScriptRunResult { stdout })
}

// ── File creation with folder-rule resolution ──

#[derive(serde::Serialize)]
pub struct NewFileContent {
    pub content: String,
    pub cursor_offset: Option<usize>,
}

/// Resolve the initial content for a newly created file by consulting folder rules.
/// Returns empty content + None cursor if no rule matches.
#[tauri::command]
pub fn resolve_new_file_content(
    path: String,
    state: State<AppState>,
) -> Result<NewFileContent, String> {
    let file_path = PathBuf::from(&path);
    validate_path(&file_path, &state).ok(); // advisory only — creating files goes through write_file later

    let config = crate::folder_rules::load_config()?;
    let rule = match crate::folder_rules::match_rule_for_file(&config, &file_path) {
        Some(r) => r,
        None => {
            return Ok(NewFileContent {
                content: String::new(),
                cursor_offset: None,
            })
        }
    };

    match rule.kind {
        crate::folder_rules::FolderRuleKind::Template => {
            let tmpl_path = PathBuf::from(&rule.target);
            if !tmpl_path.exists() {
                return Err(format!("Folder-rule template not found: {}", rule.target));
            }
            let tmpl = std::fs::read_to_string(&tmpl_path)
                .map_err(|e| format!("Failed to read template: {}", e))?;
            let (content, cursor_offset) = periodic::render_template_for_path(&tmpl, &file_path)?;
            Ok(NewFileContent {
                content,
                cursor_offset,
            })
        }
        crate::folder_rules::FolderRuleKind::Script => {
            let info = crate::scripts::find_script(&rule.target)?;
            let today = chrono::Local::now().date_naive();
            let title = file_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Untitled")
                .to_string();
            let env = periodic::build_script_env(today, &title, &file_path);
            let stdout = crate::scripts::run_script(&info, &[], &env)?;
            Ok(NewFileContent {
                content: stdout,
                cursor_offset: None,
            })
        }
    }
}

/// Format a date with moment-style tokens. Used by the Settings UI for live path previews.
#[tauri::command]
pub fn format_date_preview(format: String, date: Option<String>) -> Result<String, String> {
    let d = match date {
        Some(s) => chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d")
            .map_err(|e| format!("Invalid date '{}': {}", s, e))?,
        None => chrono::Local::now().date_naive(),
    };
    Ok(periodic::format_date(d, &format))
}
