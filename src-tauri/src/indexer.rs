use crate::db::{Database, LinkRecord};
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
                .filter_entry(|e| !is_ignored(e.file_name()))
                .filter_map(|e| e.ok())
            {
                let path = entry.path().to_path_buf();
                if path.is_file() && path.extension().map_or(false, |e| e == "md") {
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
            let db_lock = db.lock().unwrap();
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

        // 4. Execute
        let stale_count = to_remove.len();
        if !to_remove.is_empty() {
            let db_lock = db.lock().unwrap();
            if let Err(e) = db_lock.delete_files_batch(&to_remove) {
                log::error!("Failed to prune stale entries: {}", e);
            }
        }

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
        // Walk the directory
        let mut disk_files: std::collections::HashSet<String> = std::collections::HashSet::new();
        for entry in WalkDir::new(dir_path)
            .into_iter()
            .filter_entry(|e| !is_ignored(e.file_name()))
            .filter_map(|e| e.ok())
        {
            let path = entry.path().to_path_buf();
            if path.is_file() && path.extension().map_or(false, |e| e == "md") {
                let path_str = path.to_string_lossy().to_string();
                disk_files.insert(path_str.clone());
                // Reindex every file found (Rescan means we can't trust event history)
                if let Err(e) = index_single_file(&path, dir_id, db) {
                    log::error!("Rescan reindex failed for {}: {}", path.display(), e);
                }
            }
        }

        // Prune DB entries under this directory that are no longer on disk
        let dir_prefix = format!("{}/", dir_path.to_string_lossy());
        let indexed_paths = {
            let db_lock = db.lock().map_err(|e| e.to_string())?;
            db_lock.get_all_indexed_paths().unwrap_or_default()
        };

        let stale: Vec<String> = indexed_paths.into_iter()
            .filter(|(p, _)| p.starts_with(&dir_prefix) && !disk_files.contains(p))
            .map(|(p, _)| p)
            .collect();

        if !stale.is_empty() {
            let db_lock = db.lock().map_err(|e| e.to_string())?;
            db_lock.delete_files_batch(&stale)?;
            log::info!("Rescan pruned {} stale entries from {}", stale.len(), dir_path.display());
        }

        Ok(())
    }
}

fn is_ignored(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    matches!(
        name.as_ref(),
        ".obsidian" | ".git" | "node_modules" | ".DS_Store" | ".trash"
    ) || name.starts_with('.')
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

    let frontmatter_json = extract_frontmatter(&content);
    let links = extract_wikilinks(&content);
    let tags = extract_tags(&content);

    let path_str = path.to_string_lossy().to_string();

    let db = db.lock().map_err(|e| e.to_string())?;

    let file_id = db.upsert_file(
        &path_str,
        dir_id,
        title.as_deref(),
        modified_at,
        frontmatter_json.as_deref(),
    )?;

    db.set_links(file_id, &links)?;
    db.set_tags(file_id, &tags)?;

    // Resolve any pending backlinks that point to this newly-indexed file
    if let Some(ref t) = title {
        let _ = db.resolve_pending_links(t, file_id);
    }

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
fn extract_wikilinks(content: &str) -> Vec<LinkRecord> {
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
    fn test_extract_tags() {
        let content = "Hello #tag1 and #tag2/subtag\n#another but not #123invalid";
        let tags = extract_tags(content);
        assert!(tags.contains(&"tag1".to_string()));
        assert!(tags.contains(&"tag2/subtag".to_string()));
        assert!(tags.contains(&"another".to_string()));
        assert!(!tags.contains(&"123invalid".to_string()));
    }
}
