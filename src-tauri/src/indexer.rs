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
    /// Full scan of all registered directories. Runs on a background thread.
    pub fn full_scan(
        dirs: &[(String, PathBuf)], // (dir_id, path)
        db: &Mutex<Database>,
        app_handle: &tauri::AppHandle,
    ) {
        // Collect all .md files first for progress tracking
        let mut md_files: Vec<(String, PathBuf)> = Vec::new();

        for (dir_id, dir_path) in dirs {
            for entry in WalkDir::new(dir_path)
                .into_iter()
                .filter_entry(|e| !is_ignored(e.file_name()))
                .filter_map(|e| e.ok())
            {
                let path = entry.path().to_path_buf();
                if path.is_file() && path.extension().map_or(false, |e| e == "md") {
                    md_files.push((dir_id.clone(), path));
                }
            }
        }

        let total = md_files.len() as u32;
        let mut indexed: u32 = 0;

        for (dir_id, path) in &md_files {
            if let Err(e) = index_single_file(path, dir_id, db) {
                log::error!("Failed to index {}: {}", path.display(), e);
            }

            indexed += 1;

            // Emit progress every 50 files to avoid flooding the frontend
            if indexed % 50 == 0 || indexed == total {
                let _ = app_handle.emit("index:progress", IndexProgress { indexed, total });
            }
        }

        let _ = app_handle.emit("index:complete", ());
        log::info!("Full index complete: {} files indexed", total);
    }

    /// Reindex a single file (used for watcher delta updates)
    pub fn reindex_file(path: &Path, dir_id: &str, db: &Mutex<Database>) -> Result<(), String> {
        index_single_file(path, dir_id, db)
    }

    /// Remove a file from the index
    pub fn remove_file(path: &Path, db: &Mutex<Database>) -> Result<(), String> {
        let db = db.lock().map_err(|e| e.to_string())?;
        db.delete_file(&path.to_string_lossy())
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

/// Extract wikilinks [[target]] from content, with line numbers and context
fn extract_wikilinks(content: &str) -> Vec<LinkRecord> {
    let mut links = Vec::new();

    for (line_idx, line) in content.lines().enumerate() {
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

    for line in content.lines() {
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
