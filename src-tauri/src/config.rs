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
    pub style: StyleConfig,
    pub linting: LintingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct EditorConfig {
    pub font_family: String,
    pub font_size: u32,
    pub preview_font_size: Option<u32>,
    pub source_font_size: Option<u32>,
    pub line_height: f64,
    pub content_max_width: Option<u32>,
    pub default_mode: String,
    pub show_line_numbers: bool,
    pub tab_size: u32,
    pub indent_guides: bool,
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
    pub hide_empty_folders: bool,
    pub template_dirs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LintingConfig {
    pub enabled: bool,
    pub autofix_on_save: bool,
    // Per-rule toggles (autofix rules)
    pub trailing_spaces: bool,
    pub hard_tabs: bool,
    pub multiple_blanks: bool,
    pub trailing_newline: bool,
    pub atx_spacing: bool,
    pub reversed_links: bool,
    pub space_in_emphasis: bool,
    // Per-rule toggles (warning rules)
    pub heading_increment: bool,
    pub consistent_list_marker: bool,
    pub hr_style: bool,
    pub empty_links: bool,
}

impl Default for LintingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            autofix_on_save: false,
            trailing_spaces: true,
            hard_tabs: true,
            multiple_blanks: true,
            trailing_newline: true,
            atx_spacing: true,
            reversed_links: true,
            space_in_emphasis: true,
            heading_increment: true,
            consistent_list_marker: true,
            hr_style: true,
            empty_links: true,
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            editor: EditorConfig::default(),
            appearance: AppearanceConfig::default(),
            behavior: BehaviorConfig::default(),
            style: StyleConfig::default(),
            linting: LintingConfig::default(),
        }
    }
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            font_family: "Literata".to_string(),
            font_size: 16,
            preview_font_size: None,
            source_font_size: None,
            line_height: 1.7,
            content_max_width: Some(720),
            default_mode: "preview".to_string(),
            show_line_numbers: true,
            tab_size: 4,
            indent_guides: true,
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
            hide_empty_folders: true,
            template_dirs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeColorOverrides {
    pub bg_base: String,
    pub bg_surface: String,
    pub bg_elevated: String,
    pub text_primary: String,
    pub text_secondary: String,
    pub text_tertiary: String,
    pub accent: String,
    pub border_default: String,
    pub border_subtle: String,
}

impl Default for ThemeColorOverrides {
    fn default() -> Self {
        Self {
            bg_base: String::new(),
            bg_surface: String::new(),
            bg_elevated: String::new(),
            text_primary: String::new(),
            text_secondary: String::new(),
            text_tertiary: String::new(),
            accent: String::new(),
            border_default: String::new(),
            border_subtle: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct HeadingStyle {
    pub size: f64,       // em units, e.g. 2.0 for h1
    pub color: String,   // empty = inherit
}

impl Default for HeadingStyle {
    fn default() -> Self {
        Self { size: 0.0, color: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct StyleConfig {
    // Existing
    pub accent_color: String,
    pub editor_padding_x: u32,
    pub editor_padding_y: u32,
    pub inline_title_size: f64,
    pub ui_font_size: u32,
    pub custom_css: String,

    // Per-theme color overrides
    pub theme_overrides: std::collections::HashMap<String, ThemeColorOverrides>,

    // Heading styles (h1-h6)
    pub headings: std::collections::HashMap<String, HeadingStyle>,

    // Element styles
    pub blockquote_border_color: String,
    pub blockquote_border_width: u32,
    pub link_color: String,
    pub link_underline: bool,
    pub code_block_bg: String,
    pub code_block_text: String,
    pub inline_code_bg: String,
    pub inline_code_text: String,
    pub tag_bg: String,
    pub tag_text: String,

    // Spacing
    pub paragraph_spacing: u32,
    pub list_indent: u32,

    // Syntax highlighting
    pub syntax_markup: String,
    pub syntax_hr: String,
    pub syntax_meta: String,
    pub syntax_comment: String,
    pub syntax_list_marker: String,
    pub syntax_strikethrough: String,
    pub syntax_highlight_bg: String,
}

impl Default for StyleConfig {
    fn default() -> Self {
        let mut headings = std::collections::HashMap::new();
        headings.insert("h1".to_string(), HeadingStyle { size: 1.6, color: String::new() });
        headings.insert("h2".to_string(), HeadingStyle { size: 1.3, color: String::new() });
        headings.insert("h3".to_string(), HeadingStyle { size: 1.1, color: String::new() });
        headings.insert("h4".to_string(), HeadingStyle { size: 1.05, color: String::new() });
        headings.insert("h5".to_string(), HeadingStyle { size: 1.0, color: String::new() });
        headings.insert("h6".to_string(), HeadingStyle { size: 0.9, color: String::new() });

        Self {
            accent_color: String::new(),
            editor_padding_x: 48,
            editor_padding_y: 24,
            inline_title_size: 1.8,
            ui_font_size: 13,
            custom_css: String::new(),
            theme_overrides: std::collections::HashMap::new(),
            headings,
            blockquote_border_color: String::new(),
            blockquote_border_width: 3,
            link_color: String::new(),
            link_underline: true,
            code_block_bg: String::new(),
            code_block_text: String::new(),
            inline_code_bg: String::new(),
            inline_code_text: String::new(),
            tag_bg: String::new(),
            tag_text: String::new(),
            paragraph_spacing: 0,
            list_indent: 24,
            syntax_markup: String::new(),
            syntax_hr: String::new(),
            syntax_meta: String::new(),
            syntax_comment: String::new(),
            syntax_list_marker: String::new(),
            syntax_strikethrough: String::new(),
            syntax_highlight_bg: String::new(),
        }
    }
}

fn config_path() -> Result<PathBuf, String> {
    Ok(crate::paths::onyx_dir()?.join("config.json"))
}

fn onyx_dir() -> Result<PathBuf, String> {
    crate::paths::onyx_dir()
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
    Ok(crate::paths::onyx_dir()?.join("keybindings.json"))
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
