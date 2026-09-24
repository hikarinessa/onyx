use crate::canvas;
use crate::db::{Database, LinkRecord};
use crate::skip;
use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use tauri::Emitter;
use walkdir::WalkDir;

static RE_WIKILINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[\[([^\]]+)\]\]").unwrap());
static RE_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:^|[\s])#([a-zA-Z][a-zA-Z0-9_/-]*)").unwrap());

#[derive(Clone, serde::Serialize)]
struct IndexProgress {
    indexed: u32,
    total: u32,
}

pub struct Indexer;

/// Files the index holds: notes and canvases. Canvases get a row (title = file stem, so
/// Quick Open finds them) and the links they make, and no frontmatter or tags.
pub fn is_indexed_file(path: &Path) -> bool {
    path.extension().is_some_and(|e| e == "md") || canvas::is_canvas_path(path)
}

impl Indexer {
    /// Reindex a single file (used for watcher delta updates)
    pub fn reindex_file(path: &Path, dir_id: &str, db: &Mutex<Database>) -> Result<(), String> {
        index_single_file(path, dir_id, db)
    }

    /// Remove a file from the index
    pub fn remove_file(path: &Path, db: &Mutex<Database>) -> Result<(), String> {
        let db = db.lock().map_err(|e| e.to_string())?;
        db.delete_file(&path.to_string_lossy())
    }

    /// Startup reconciliation: diff disk state vs DB, prune stale entries, add missing files,
    /// reindex changed files. Replaces full_scan for startup.
    pub fn reconcile(
        dirs: &[(String, PathBuf)],
        db: &Mutex<Database>,
        app_handle: &tauri::AppHandle,
    ) {
        // 1. Walk all registered dirs → collect (path, mtime) from disk
        let mut disk_files: std::collections::HashMap<String, Option<i64>> = std::collections::HashMap::new();
        let mut disk_dir_ids: std::collections::HashMap<String, String> = std::collections::HashMap::new();

        for (dir_id, dir_path) in dirs {
            for entry in WalkDir::new(dir_path)
                .into_iter()
                .filter_entry(|e| !is_ignored(e))
                .filter_map(|e| e.ok())
            {
                let path = entry.path().to_path_buf();
                if path.is_file() && is_indexed_file(&path) {
                    let path_str = path.to_string_lossy().to_string();
                    let mtime = path.metadata().ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64);
                    disk_files.insert(path_str.clone(), mtime);
                    disk_dir_ids.insert(path_str, dir_id.clone());
                }
            }
        }

        // 2. Query all indexed paths from DB
        let indexed_paths = {
            let db_lock = match db.lock() {
                Ok(l) => l,
                Err(e) => {
                    log::error!("Reconciliation aborted: DB mutex poisoned: {}", e);
                    let _ = app_handle.emit("index:complete", ());
                    return;
                }
            };
            db_lock.get_all_indexed_paths().unwrap_or_default()
        };
        let indexed_map: std::collections::HashMap<String, Option<i64>> = indexed_paths.into_iter().collect();

        // 3. Diff
        let mut to_index: Vec<(String, String)> = Vec::new(); // (path, dir_id)
        let mut to_remove: Vec<String> = Vec::new();

        // Files on disk but not in DB, or changed since last index
        for (path, disk_mtime) in &disk_files {
            let dir_id = disk_dir_ids.get(path).cloned().unwrap_or_default();
            match indexed_map.get(path) {
                None => {
                    // New file on disk
                    to_index.push((path.clone(), dir_id));
                }
                Some(indexed_at) => {
                    // File exists in both — check if mtime > indexed_at
                    if let (Some(mt), Some(ia)) = (disk_mtime, indexed_at) {
                        if *mt > *ia {
                            to_index.push((path.clone(), dir_id));
                        }
                    }
                }
            }
        }

        // Files in DB but not on disk
        for (path, _) in &indexed_map {
            if !disk_files.contains_key(path) {
                to_remove.push(path.clone());
            }
        }

        // 4. Execute — reindex BEFORE pruning stale entries.
        // If all files in a folder were renamed (e.g. folder rename while Onyx was closed),
        // old paths land in to_remove and new paths in to_index. Pruning first would create
        // a window where has_files_under() reports the folder as empty, causing it to vanish
        // from the sidebar when hide_empty_folders is on. Reindexing first keeps old rows
        // alongside new ones until the prune completes — the folder never appears empty.
        let total = to_index.len() as u32;
        let mut indexed: u32 = 0;
        for (path, dir_id) in &to_index {
            let path_buf = PathBuf::from(path);
            if let Err(e) = index_single_file(&path_buf, dir_id, db) {
                log::error!("Failed to index {}: {}", path, e);
            }
            indexed += 1;
            if indexed % 50 == 0 || indexed == total {
                let _ = app_handle.emit("index:progress", IndexProgress { indexed, total });
            }
        }

        let stale_count = to_remove.len();
        if !to_remove.is_empty() {
            let db_lock = match db.lock() {
                Ok(l) => l,
                Err(e) => {
                    log::error!("Failed to lock DB for pruning: {}", e);
                    let _ = app_handle.emit("index:complete", ());
                    return;
                }
            };
            if let Err(e) = db_lock.delete_files_batch(&to_remove) {
                log::error!("Failed to prune stale entries: {}", e);
            }
        }

        let _ = app_handle.emit("index:complete", ());
        log::info!(
            "Reconciliation complete: {} indexed, {} pruned, {} unchanged",
            to_index.len(), stale_count, disk_files.len().saturating_sub(to_index.len())
        );
    }

    /// Targeted reconciliation for a single directory (used after Rescan events).
    pub fn reconcile_directory(
        dir_path: &Path,
        dir_id: &str,
        db: &Mutex<Database>,
    ) -> Result<(), String> {
        // Fetch indexed state for this directory up front (one short DB lock).
        // A Rescan event invalidates the watcher's event history, not the index —
        // stored indexed_at timestamps are still trustworthy for diffing.
        let dir_prefix = format!("{}/", dir_path.to_string_lossy());
        let indexed_map: std::collections::HashMap<String, Option<i64>> = {
            let db_lock = db.lock().map_err(|e| e.to_string())?;
            db_lock.get_indexed_paths_by_prefix(&dir_prefix).unwrap_or_default()
                .into_iter().collect()
        };

        // Walk the directory; reindex only new or modified files
        let mut disk_files: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut reindexed: u32 = 0;
        for entry in WalkDir::new(dir_path)
            .into_iter()
            .filter_entry(|e| !is_ignored(e))
            .filter_map(|e| e.ok())
        {
            let path = entry.path().to_path_buf();
            if path.is_file() && is_indexed_file(&path) {
                let path_str = path.to_string_lossy().to_string();
                let changed = match indexed_map.get(&path_str) {
                    None => true,
                    Some(indexed_at) => {
                        let disk_mtime = path.metadata().ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64);
                        // Same semantics as startup reconcile(): only reindex when
                        // both timestamps exist and the file is newer than its index entry
                        matches!((disk_mtime, indexed_at), (Some(mt), Some(ia)) if mt > *ia)
                    }
                };
                disk_files.insert(path_str);
                if changed {
                    if let Err(e) = index_single_file(&path, dir_id, db) {
                        log::error!("Rescan reindex failed for {}: {}", path.display(), e);
                    }
                    reindexed += 1;
                }
            }
        }

        // Prune DB entries under this directory that are no longer on disk
        let stale: Vec<String> = indexed_map.keys()
            .filter(|p| !disk_files.contains(*p))
            .cloned()
            .collect();

        if !stale.is_empty() {
            let db_lock = db.lock().map_err(|e| e.to_string())?;
            db_lock.delete_files_batch(&stale)?;
        }

        log::info!(
            "Rescan reconcile for {}: {} reindexed, {} pruned, {} unchanged",
            dir_path.display(), reindexed, stale.len(),
            disk_files.len().saturating_sub(reindexed as usize)
        );

        Ok(())
    }
}

/// Walk filter: the registered root itself is always walked; everything below it goes
/// through the shared skip rules so the index matches the tree and the watcher.
pub(crate) fn is_ignored(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    let parent = entry
        .path()
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_string());
    skip::is_skipped_entry(&name, parent.as_deref())
}

fn index_single_file(path: &Path, dir_id: &str, db: &Mutex<Database>) -> Result<(), String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let title = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string());

    let modified_at = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);

    let path_str = path.to_string_lossy().to_string();

    if canvas::is_canvas_path(path) {
        let db = db.lock().map_err(|e| e.to_string())?;
        // File nodes are written relative to the canvas's root; the root is only
        // known to the index, so the links are read under its lock.
        let links = canvas::links(&content, db.root_of(&path_str).as_deref());
        db.index_file(&path_str, dir_id, title.as_deref(), modified_at, None, &links, &[])?;
        return Ok(());
    }

    let frontmatter_json = extract_frontmatter(&content);
    let links = extract_wikilinks(&content);
    let tags = extract_tags(&content);

    let db = db.lock().map_err(|e| e.to_string())?;
    db.index_file(
        &path_str,
        dir_id,
        title.as_deref(),
        modified_at,
        frontmatter_json.as_deref(),
        &links,
        &tags,
    )?;

    Ok(())
}

/// Extract YAML frontmatter between --- delimiters and return as JSON string
fn extract_frontmatter(content: &str) -> Option<String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    let end = after_first.find("\n---")?;
    let yaml_str = &after_first[..end].trim();

    if yaml_str.is_empty() {
        return None;
    }

    // Parse YAML then convert to JSON for storage
    let value: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml_str).ok()?;
    serde_json::to_string(&value).ok()
}

/// Returns (line_idx, line) pairs for lines outside frontmatter and code blocks.
fn lines_outside_code_blocks(content: &str) -> Vec<(usize, &str)> {
    let mut result = Vec::new();
    let mut in_code_block = false;
    let mut in_frontmatter = false;
    let mut fm_started = false;

    for (line_idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        // Track frontmatter (only at start of file)
        if line_idx == 0 && trimmed == "---" {
            fm_started = true;
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter && fm_started && trimmed == "---" {
            in_frontmatter = false;
            continue;
        }
        if in_frontmatter { continue; }

        // Track code fences
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block { continue; }

        result.push((line_idx, line));
    }

    result
}

/// Extract wikilinks [[target]] from content, with line numbers and context
pub(crate) fn extract_wikilinks(content: &str) -> Vec<LinkRecord> {
    let mut links = Vec::new();

    for (line_idx, line) in lines_outside_code_blocks(content) {
        for cap in RE_WIKILINK.captures_iter(line) {
            let target = cap.get(1).unwrap().as_str();

            // Handle [[target|alias]] — take the target part
            let target = target.split('|').next().unwrap_or(target).trim();
            // Handle [[target#heading]] — take the target part
            let target = target.split('#').next().unwrap_or(target).trim();

            if target.is_empty() {
                continue;
            }

            let context = line.trim().to_string();

            links.push(LinkRecord {
                target: target.to_string(),
                line_number: Some((line_idx + 1) as i32),
                context: Some(context),
            });
        }
    }

    links
}

/// Extract #tags from content
fn extract_tags(content: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();

    for (_, line) in lines_outside_code_blocks(content) {
        for cap in RE_TAG.captures_iter(line) {
            let tag = cap.get(1).unwrap().as_str().to_string();
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }
    }

    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_frontmatter() {
        let content = "---\ntitle: Hello\ntags:\n  - foo\n---\n\nBody text";
        let result = extract_frontmatter(content);
        assert!(result.is_some());
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        assert_eq!(json["title"], "Hello");
    }

    #[test]
    fn test_extract_frontmatter_with_type_key() {
        let content = "---\ntype: person\nFull Name: Marc Kirsch\nBirthday: 2025-12-02\n---\n\nBody";
        let result = extract_frontmatter(content);
        assert!(result.is_some(), "frontmatter should be Some");
        let json: serde_json::Value = serde_json::from_str(&result.unwrap()).unwrap();
        println!("JSON output: {}", json);
        assert_eq!(json["type"], "person", "type field missing from JSON");
        assert_eq!(json["Full Name"], "Marc Kirsch");
    }

    #[test]
    fn test_extract_frontmatter_none() {
        let content = "No frontmatter here";
        assert!(extract_frontmatter(content).is_none());
    }

    #[test]
    fn test_extract_wikilinks() {
        let content = "Check [[Note A]] and also [[Note B|alias]] and [[Note C#heading]]";
        let links = extract_wikilinks(content);
        assert_eq!(links.len(), 3);
        assert_eq!(links[0].target, "Note A");
        assert_eq!(links[1].target, "Note B");
        assert_eq!(links[2].target, "Note C");
    }

    #[test]
    fn a_note_on_a_canvas_lists_the_canvas_as_a_backlink() {
        let dir = std::env::temp_dir().join(format!("onyx-indexer-canvas-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("root");
        std::fs::create_dir_all(root.join("Notes")).unwrap();
        let root_str = root.to_string_lossy().to_string();
        let note = root.join("Notes/Gamma.md");
        let other = root.join("Alpha.md");
        let board = root.join("Plan.canvas");
        std::fs::write(&note, "# Gamma\n#tag").unwrap();
        std::fs::write(&other, "alpha").unwrap();
        std::fs::write(&board, r##"{"nodes":[
            {"id":"t","type":"text","text":"About [[Alpha]] #notatag"},
            {"id":"f","type":"file","file":"Notes/Gamma.md"}
        ],"edges":[]}"##).unwrap();

        let mut database = Database::new(&dir.join("index.db")).unwrap();
        database.set_roots(vec![root_str.clone()]).unwrap();
        let db = Mutex::new(database);
        for p in [&note, &other, &board] {
            Indexer::reindex_file(p, "d", &db).unwrap();
        }
        let db = db.lock().unwrap();

        let back = db.get_backlinks(&note.to_string_lossy()).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].source_path, board.to_string_lossy());
        assert_eq!(back[0].source_title.as_deref(), Some("Plan"));
        assert_eq!(back[0].line_number, Some(1));
        assert_eq!(back[0].context.as_deref(), Some("Gamma.md"));

        let back = db.get_backlinks(&other.to_string_lossy()).unwrap();
        assert_eq!(back[0].line_number, Some(0));
        assert_eq!(back[0].context.as_deref(), Some("About [[Alpha]] #notatag"));

        let found = db.search_files("plan").unwrap();
        assert!(found.iter().any(|r| r.path == board.to_string_lossy()), "Quick Open finds the canvas");
        assert_eq!(db.get_frontmatter(&board.to_string_lossy()).unwrap(), None);
        let tags: Vec<String> = db.get_all_tags().unwrap().into_iter().map(|t| t.tag).collect();
        assert_eq!(tags, ["tag"], "a canvas contributes no tags");
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_extract_tags() {
        let content = "Hello #tag1 and #tag2/subtag\n#another but not #123invalid";
        let tags = extract_tags(content);
        assert!(tags.contains(&"tag1".to_string()));
        assert!(tags.contains(&"tag2/subtag".to_string()));
        assert!(tags.contains(&"another".to_string()));
        assert!(!tags.contains(&"123invalid".to_string()));
    }
}
