use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyDef {
    pub key: String,
    #[serde(rename = "type")]
    pub prop_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectType {
    pub name: String,
    pub properties: Vec<PropertyDef>,
}

fn config_path() -> Result<PathBuf, String> {
    Ok(crate::paths::onyx_dir()?.join("object-types.json"))
}

fn default_types() -> Vec<ObjectType> {
    vec![
        ObjectType {
            name: "Person".to_string(),
            properties: vec![
                PropertyDef {
                    key: "Full Name".to_string(),
                    prop_type: "text".to_string(),
                    required: Some(true),
                    options: None,
                    min: None,
                    max: None,
                },
                PropertyDef {
                    key: "Birthday".to_string(),
                    prop_type: "date".to_string(),
                    required: None,
                    options: None,
                    min: None,
                    max: None,
                },
                PropertyDef {
                    key: "Email".to_string(),
                    prop_type: "text".to_string(),
                    required: None,
                    options: None,
                    min: None,
                    max: None,
                },
                PropertyDef {
                    key: "Tags".to_string(),
                    prop_type: "tags".to_string(),
                    required: None,
                    options: None,
                    min: None,
                    max: None,
                },
            ],
        },
        ObjectType {
            name: "Book".to_string(),
            properties: vec![
                PropertyDef {
                    key: "Author".to_string(),
                    prop_type: "text".to_string(),
                    required: Some(true),
                    options: None,
                    min: None,
                    max: None,
                },
                PropertyDef {
                    key: "Status".to_string(),
                    prop_type: "select".to_string(),
                    required: None,
                    options: Some(vec![
                        "reading".to_string(),
                        "finished".to_string(),
                        "dropped".to_string(),
                    ]),
                    min: None,
                    max: None,
                },
                PropertyDef {
                    key: "Rating".to_string(),
                    prop_type: "number".to_string(),
                    required: None,
                    options: None,
                    min: Some(1.0),
                    max: Some(5.0),
                },
                PropertyDef {
                    key: "Finished".to_string(),
                    prop_type: "date".to_string(),
                    required: None,
                    options: None,
                    min: None,
                    max: None,
                },
            ],
        },
    ]
}

pub fn save_object_types(types: &[ObjectType]) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    let json = serde_json::to_string_pretty(types)
        .map_err(|e| format!("Failed to serialize object types: {}", e))?;

    // Atomic write
    let counter = std::sync::atomic::AtomicU64::new(0);
    let temp_path = path.with_extension(format!("tmp-{}", counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    std::fs::write(&temp_path, &json)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    std::fs::rename(&temp_path, &path)
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            format!("Failed to rename temp file: {}", e)
        })?;
    Ok(())
}

pub fn load_object_types() -> Result<Vec<ObjectType>, String> {
    let path = config_path()?;

    if !path.exists() {
        // Create the file with default types
        let defaults = default_types();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }
        let json = serde_json::to_string_pretty(&defaults)
            .map_err(|e| format!("Failed to serialize default object types: {}", e))?;
        std::fs::write(&path, json)
            .map_err(|e| format!("Failed to write object-types.json: {}", e))?;
        return Ok(defaults);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read object-types.json: {}", e))?;
    let types: Vec<ObjectType> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse object-types.json: {}", e))?;
    Ok(types)
}
