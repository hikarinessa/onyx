use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

// ── Config ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub editor: EditorConfig,
    pub appearance: AppearanceConfig,
    pub behavior: BehaviorConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct EditorConfig {
    pub font_family: String,
    pub font_size: u32,
    pub line_height: f64,
    pub content_max_width: Option<u32>,
    pub default_mode: String,
    pub show_line_numbers: bool,
    pub tab_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppearanceConfig {
    pub theme: String,
    pub sidebar_width: u32,
    pub context_panel_width: u32,
    pub ui_font: Option<String>,
    pub mono_font: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BehaviorConfig {
    pub auto_save_ms: u32,
    pub spellcheck: bool,
    pub new_note_location: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            editor: EditorConfig::default(),
            appearance: AppearanceConfig::default(),
            behavior: BehaviorConfig::default(),
        }
    }
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            font_family: "Literata".to_string(),
            font_size: 16,
            line_height: 1.7,
            content_max_width: Some(720),
            default_mode: "preview".to_string(),
            show_line_numbers: true,
            tab_size: 4,
        }
    }
}

impl Default for AppearanceConfig {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            sidebar_width: 240,
            context_panel_width: 280,
            ui_font: None,
            mono_font: None,
        }
    }
}

impl Default for BehaviorConfig {
    fn default() -> Self {
        Self {
            auto_save_ms: 500,
            spellcheck: true,
            new_note_location: "first_dir".to_string(),
        }
    }
}

fn config_path() -> Result<PathBuf, String> {
    Ok(dirs_next::home_dir()
        .ok_or("Could not find home directory")?
        .join(".onyx")
        .join("config.json"))
}

fn onyx_dir() -> Result<PathBuf, String> {
    Ok(dirs_next::home_dir()
        .ok_or("Could not find home directory")?
        .join(".onyx"))
}

/// Load config from disk. Returns defaults if file doesn't exist or is unparseable.
pub fn load_config() -> Config {
    let path = match config_path() {
        Ok(p) => p,
        Err(_) => return Config::default(),
    };

    if !path.exists() {
        let config = Config::default();
        // Write defaults to disk so the file exists for manual editing
        let _ = write_config(&config);
        return config;
    }

    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

/// Atomic write of config to disk (pretty-printed JSON).
fn write_config(config: &Config) -> Result<(), String> {
    let dir = onyx_dir()?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create ~/.onyx: {}", e))?;

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    let path = dir.join("config.json");
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_path = dir.join(format!(".config-tmp-{}-{}", std::process::id(), counter));

    fs::write(&temp_path, &json)
        .map_err(|e| format!("Failed to write config temp file: {}", e))?;

    fs::rename(&temp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Failed to rename config temp file: {}", e)
    })
}

/// Deep-merge a partial JSON value into an existing config.
/// Only overwrites fields present in the partial; everything else is preserved.
fn deep_merge(base: &mut serde_json::Value, patch: &serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(base_map), serde_json::Value::Object(patch_map)) => {
            for (key, patch_val) in patch_map {
                let entry = base_map
                    .entry(key.clone())
                    .or_insert(serde_json::Value::Null);
                deep_merge(entry, patch_val);
            }
        }
        (base, patch) => {
            *base = patch.clone();
        }
    }
}

/// Apply a partial JSON update to the current config and write to disk.
/// Returns the updated config.
pub fn update_config(
    current: &Config,
    partial_json: &str,
) -> Result<Config, String> {
    let patch: serde_json::Value = serde_json::from_str(partial_json)
        .map_err(|e| format!("Invalid config JSON: {}", e))?;

    let mut base: serde_json::Value = serde_json::to_value(current)
        .map_err(|e| format!("Failed to serialize current config: {}", e))?;

    deep_merge(&mut base, &patch);

    let merged: Config = serde_json::from_value(base)
        .map_err(|e| format!("Failed to parse merged config: {}", e))?;

    write_config(&merged)?;
    Ok(merged)
}

// ── Keybindings ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyBinding {
    pub command: String,
    pub key: String,
}

fn keybindings_path() -> Result<PathBuf, String> {
    Ok(dirs_next::home_dir()
        .ok_or("Could not find home directory")?
        .join(".onyx")
        .join("keybindings.json"))
}

pub fn load_keybindings() -> Result<Vec<KeyBinding>, String> {
    let path = keybindings_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read keybindings.json: {}", e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse keybindings.json: {}", e))
}

pub fn save_keybindings(bindings: &[KeyBinding]) -> Result<(), String> {
    let dir = onyx_dir()?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create ~/.onyx: {}", e))?;

    let json = serde_json::to_string_pretty(bindings)
        .map_err(|e| format!("Failed to serialize keybindings: {}", e))?;

    let path = dir.join("keybindings.json");
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_path = dir.join(format!(".keybindings-tmp-{}-{}", std::process::id(), counter));

    fs::write(&temp_path, &json)
        .map_err(|e| format!("Failed to write keybindings temp file: {}", e))?;

    fs::rename(&temp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Failed to rename keybindings temp file: {}", e)
    })
}
