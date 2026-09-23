use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// `path` is `prefix` itself or lies inside it. A bare `starts_with` would also match a
/// sibling that shares the prefix ("Notes" and "Notes Archive").
fn is_under(path: &str, prefix: &str) -> bool {
    path == prefix || path.strip_prefix(prefix).is_some_and(|rest| rest.starts_with('/'))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub path: String,
    pub label: String,
    pub position: u32,
}

pub struct BookmarkManager {
    config_path: PathBuf,
    bookmarks: Vec<Bookmark>,
}

impl BookmarkManager {
    pub fn new() -> Result<Self, String> {
        let config_dir = crate::paths::onyx_dir()?;
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create onyx dir: {}", e))?;

        let config_path = config_dir.join("bookmarks.json");

        let bookmarks = if config_path.exists() {
            let data = fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read bookmarks.json: {}", e))?;
            serde_json::from_str(&data)
                .map_err(|e| format!("Failed to parse bookmarks.json: {}", e))?
        } else {
            Vec::new()
        };

        Ok(Self { config_path, bookmarks })
    }

    pub fn list(&self) -> &[Bookmark] {
        &self.bookmarks
    }

    pub fn is_bookmarked(&self, path: &str) -> bool {
        self.bookmarks.iter().any(|b| b.path == path)
    }

    pub fn toggle(&mut self, path: &str, label: &str) -> Result<bool, String> {
        if let Some(idx) = self.bookmarks.iter().position(|b| b.path == path) {
            self.bookmarks.remove(idx);
            self.recompute_positions();
            self.save()?;
            Ok(false)
        } else {
            let position = self.bookmarks.len() as u32;
            self.bookmarks.push(Bookmark {
                path: path.to_string(),
                label: label.to_string(),
                position,
            });
            self.save()?;
            Ok(true)
        }
    }

    /// Update bookmark paths when a file is renamed.
    pub fn rename_path(&mut self, old_path: &str, new_path: &str) -> Result<bool, String> {
        let mut changed = false;
        for bookmark in &mut self.bookmarks {
            if bookmark.path == old_path {
                bookmark.path = new_path.to_string();
                // Update label if it was the filename
                let old_name = old_path.rsplit('/').next().unwrap_or(old_path);
                if bookmark.label == old_name {
                    bookmark.label = new_path.rsplit('/').next().unwrap_or(new_path).to_string();
                }
                changed = true;
            }
        }
        if changed {
            self.save()?;
        }
        Ok(changed)
    }

    /// Update bookmark paths when a directory is renamed (prefix change).
    pub fn rename_prefix(&mut self, old_prefix: &str, new_prefix: &str) -> Result<bool, String> {
        let mut changed = false;
        for bookmark in &mut self.bookmarks {
            if is_under(&bookmark.path, old_prefix) {
                bookmark.path = format!("{}{}", new_prefix, &bookmark.path[old_prefix.len()..]);
                changed = true;
            }
        }
        if changed {
            self.save()?;
        }
        Ok(changed)
    }

    /// Remove bookmarks for a deleted file, or for everything inside a deleted folder.
    pub fn remove_path(&mut self, path: &str) -> Result<bool, String> {
        let len_before = self.bookmarks.len();
        self.bookmarks.retain(|b| !is_under(&b.path, path));
        if self.bookmarks.len() != len_before {
            self.recompute_positions();
            self.save()?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Migrate existing bookmarks from DB and global-bookmarks.json.
    /// Called once on first launch after upgrade.
    pub fn migrate(
        &mut self,
        db_bookmarks: Vec<(String, Option<String>)>,  // (path, label)
        global_bookmarks: Vec<(String, String)>,        // (path, label)
    ) -> Result<(), String> {
        if !self.bookmarks.is_empty() {
            return Ok(()); // Already migrated
        }

        let mut seen = std::collections::HashSet::new();
        let mut position = 0u32;

        // DB bookmarks first (they had explicit ordering)
        for (path, label) in db_bookmarks {
            if seen.insert(path.clone()) {
                self.bookmarks.push(Bookmark {
                    label: label.unwrap_or_else(|| {
                        path.rsplit('/').next().unwrap_or(&path).to_string()
                    }),
                    path,
                    position,
                });
                position += 1;
            }
        }

        // Then global bookmarks
        for (path, label) in global_bookmarks {
            if seen.insert(path.clone()) {
                self.bookmarks.push(Bookmark {
                    path,
                    label,
                    position,
                });
                position += 1;
            }
        }

        if !self.bookmarks.is_empty() {
            self.save()?;
        }
        Ok(())
    }

    fn recompute_positions(&mut self) {
        for (i, b) in self.bookmarks.iter_mut().enumerate() {
            b.position = i as u32;
        }
    }

    fn save(&self) -> Result<(), String> {
        let dir = self.config_path.parent().unwrap();
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp_path = dir.join(format!(".bookmarks-tmp-{}-{}", std::process::id(), counter));

        let data = serde_json::to_string_pretty(&self.bookmarks)
            .map_err(|e| format!("Failed to serialize bookmarks: {}", e))?;

        fs::write(&temp_path, &data)
            .map_err(|e| format!("Failed to write bookmarks temp file: {}", e))?;

        fs::rename(&temp_path, &self.config_path).map_err(|e| {
            let _ = fs::remove_file(&temp_path);
            format!("Failed to rename bookmarks temp file: {}", e)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager(paths: &[&str]) -> (BookmarkManager, PathBuf) {
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("onyx-bm-test-{}-{}", std::process::id(), counter));
        fs::create_dir_all(&dir).unwrap();
        let bookmarks = paths.iter().enumerate().map(|(i, p)| Bookmark {
            path: p.to_string(),
            label: p.rsplit('/').next().unwrap().to_string(),
            position: i as u32,
        }).collect();
        (BookmarkManager { config_path: dir.join("bookmarks.json"), bookmarks }, dir)
    }

    fn paths(m: &BookmarkManager) -> Vec<&str> {
        m.list().iter().map(|b| b.path.as_str()).collect()
    }

    #[test]
    fn folder_rename_leaves_siblings_sharing_a_prefix() {
        let (mut m, dir) = manager(&["/v/Notes/a.md", "/v/Notes Archive/b.md"]);
        m.rename_prefix("/v/Notes", "/v/Journal").unwrap();
        assert_eq!(paths(&m), ["/v/Journal/a.md", "/v/Notes Archive/b.md"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn folder_delete_drops_bookmarks_inside_it_only() {
        let (mut m, dir) = manager(&["/v/Notes/a.md", "/v/Notes2.md", "/v/c.md"]);
        m.remove_path("/v/Notes").unwrap();
        assert_eq!(paths(&m), ["/v/Notes2.md", "/v/c.md"]);
        fs::remove_dir_all(dir).unwrap();
    }
}
