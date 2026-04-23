use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FolderRuleKind {
    Template,
    Script,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderRule {
    /// Absolute folder path. Exact-match only (no recursion).
    pub folder: String,
    pub kind: FolderRuleKind,
    /// For Template: relative path within the registered directory.
    /// For Script: script name (from ~/.onyx/scripts/).
    pub target: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FolderRulesConfig {
    #[serde(default)]
    pub rules: Vec<FolderRule>,
}

fn config_path() -> Result<PathBuf, String> {
    Ok(crate::paths::onyx_dir()?.join("folder-rules.json"))
}

pub fn load_config() -> Result<FolderRulesConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(FolderRulesConfig::default());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read folder-rules.json: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse folder-rules.json: {}", e))
}

pub fn save_config(config: &FolderRulesConfig) -> Result<(), String> {
    let path = config_path()?;
    let dir = path.parent().ok_or("Invalid config path")?;
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize folder rules: {}", e))?;

    let temp_path = dir.join(".folder-rules-tmp");
    std::fs::write(&temp_path, &json)
        .map_err(|e| format!("Failed to write folder rules temp file: {}", e))?;
    std::fs::rename(&temp_path, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to rename folder rules temp file: {}", e)
    })
}

/// Find a rule matching the parent folder of the given file path.
/// Exact match only — a rule for `/a/b` does not match files in `/a/b/c`.
pub fn match_rule_for_file(config: &FolderRulesConfig, file_path: &Path) -> Option<FolderRule> {
    let parent = file_path.parent()?;
    let parent_str = parent.to_string_lossy();
    config
        .rules
        .iter()
        .find(|r| {
            let rule_folder = r.folder.trim_end_matches('/');
            let parent = parent_str.trim_end_matches('/');
            rule_folder == parent
        })
        .cloned()
}
