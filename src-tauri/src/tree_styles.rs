//! Per-path icon and colour for files and folders in the tree (~/.onyx/tree-styles.json).
//!
//! Keyed by absolute path, like bookmarks: `rename_file` and `trash_file` keep the keys
//! pointed at the right entries. Registered root directories keep their own icon and
//! colour in directories.json, since they are keyed by id.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TreeStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

impl TreeStyle {
    fn is_empty(&self) -> bool {
        self.icon.is_none() && self.color.is_none()
    }
}

/// A kebab-case icon name, as the frontend catalogs use.
pub fn validate_icon(icon: &str) -> Result<(), String> {
    if icon.is_empty() || icon.len() > 64
        || !icon.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!("Invalid icon name: {}", icon));
    }
    Ok(())
}

/// A palette name ("teal") or a custom "#rrggbb".
pub fn validate_color(color: &str) -> Result<(), String> {
    let ok = if let Some(hex) = color.strip_prefix('#') {
        hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit())
    } else {
        !color.is_empty() && color.len() <= 32 && color.chars().all(|c| c.is_ascii_lowercase())
    };
    if ok { Ok(()) } else { Err(format!("Invalid colour: {}", color)) }
}

/// `path` is `prefix` itself or lies inside it.
fn is_under(path: &str, prefix: &str) -> bool {
    path == prefix || path.strip_prefix(prefix).is_some_and(|rest| rest.starts_with('/'))
}

pub struct TreeStyleManager {
    config_path: PathBuf,
    styles: BTreeMap<String, TreeStyle>,
}

impl TreeStyleManager {
    pub fn new() -> Result<Self, String> {
        let config_dir = crate::paths::onyx_dir()?;
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create onyx dir: {}", e))?;
        let config_path = config_dir.join("tree-styles.json");
        let styles = if config_path.exists() {
            let data = fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read tree-styles.json: {}", e))?;
            serde_json::from_str(&data)
                .map_err(|e| format!("Failed to parse tree-styles.json: {}", e))?
        } else {
            BTreeMap::new()
        };
        Ok(Self { config_path, styles })
    }

    #[cfg(test)]
    fn in_memory() -> Self {
        Self { config_path: PathBuf::new(), styles: BTreeMap::new() }
    }

    pub fn all(&self) -> &BTreeMap<String, TreeStyle> {
        &self.styles
    }

    /// Set or clear the style for a path. A style with neither field set removes the entry.
    pub fn set(&mut self, path: &str, style: TreeStyle) -> Result<(), String> {
        if let Some(icon) = &style.icon { validate_icon(icon)?; }
        if let Some(color) = &style.color { validate_color(color)?; }
        if style.is_empty() {
            if self.styles.remove(path).is_none() { return Ok(()); }
        } else {
            self.styles.insert(path.to_string(), style);
        }
        self.save()
    }

    /// Move the style of `old` (and, for a folder, everything inside it) to `new`.
    pub fn rename(&mut self, old: &str, new: &str) -> Result<bool, String> {
        let moved: Vec<String> = self.styles.keys().filter(|k| is_under(k, old)).cloned().collect();
        if moved.is_empty() { return Ok(false); }
        for key in moved {
            if let Some(style) = self.styles.remove(&key) {
                self.styles.insert(format!("{}{}", new, &key[old.len()..]), style);
            }
        }
        self.save()?;
        Ok(true)
    }

    /// Drop the style of `path` and of everything inside it.
    pub fn remove(&mut self, path: &str) -> Result<bool, String> {
        let before = self.styles.len();
        self.styles.retain(|k, _| !is_under(k, path));
        if self.styles.len() == before { return Ok(false); }
        self.save()?;
        Ok(true)
    }

    fn save(&self) -> Result<(), String> {
        #[cfg(test)]
        if self.config_path.as_os_str().is_empty() { return Ok(()); }

        let data = serde_json::to_string_pretty(&self.styles)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        let dir = self.config_path.parent().ok_or("tree-styles.json has no parent")?;
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp_path = dir.join(format!(".tree-styles-tmp-{}-{}", std::process::id(), counter));
        fs::write(&temp_path, &data)
            .map_err(|e| format!("Failed to write tree-styles temp file: {}", e))?;
        fs::rename(&temp_path, &self.config_path).map_err(|e| {
            let _ = fs::remove_file(&temp_path);
            format!("Failed to rename tree-styles temp file: {}", e)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn style(icon: &str) -> TreeStyle {
        TreeStyle { icon: Some(icon.into()), color: None }
    }

    #[test]
    fn rename_moves_folder_contents_but_not_siblings_sharing_a_prefix() {
        let mut m = TreeStyleManager::in_memory();
        m.set("/v/Notes", style("book")).unwrap();
        m.set("/v/Notes/a.md", style("star")).unwrap();
        m.set("/v/Notes Archive/b.md", style("archive")).unwrap();
        m.rename("/v/Notes", "/v/Journal").unwrap();
        let keys: Vec<&str> = m.all().keys().map(|k| k.as_str()).collect();
        assert_eq!(keys, ["/v/Journal", "/v/Journal/a.md", "/v/Notes Archive/b.md"]);
    }

    #[test]
    fn remove_drops_folder_contents_but_not_siblings_sharing_a_prefix() {
        let mut m = TreeStyleManager::in_memory();
        m.set("/v/Notes/a.md", style("star")).unwrap();
        m.set("/v/Notes2.md", style("star")).unwrap();
        m.remove("/v/Notes").unwrap();
        assert!(m.all().contains_key("/v/Notes2.md"));
        assert!(!m.all().contains_key("/v/Notes/a.md"));
    }

    #[test]
    fn empty_style_clears_the_entry() {
        let mut m = TreeStyleManager::in_memory();
        m.set("/v/a.md", style("star")).unwrap();
        m.set("/v/a.md", TreeStyle::default()).unwrap();
        assert!(m.all().is_empty());
    }

    #[test]
    fn colours_are_palette_names_or_hex() {
        assert!(validate_color("teal").is_ok());
        assert!(validate_color("#a1b2c3").is_ok());
        assert!(validate_color("#abc").is_err());
        assert!(validate_color("var(--x)").is_err());
        assert!(validate_color("").is_err());
    }
}
