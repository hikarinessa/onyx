use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredDirectory {
    pub id: String,
    pub path: PathBuf,
    pub label: String,
    pub color: String,
    pub position: u32,
}

pub struct DirectoryManager {
    config_path: PathBuf,
    directories: Vec<RegisteredDirectory>,
}

impl DirectoryManager {
    pub fn new() -> Result<Self, String> {
        let config_dir = dirs_next::home_dir()
            .ok_or("Could not find home directory")?
            .join(".onyx");

        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create ~/.onyx: {}", e))?;

        let config_path = config_dir.join("directories.json");

        let directories = if config_path.exists() {
            let data = fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read directories.json: {}", e))?;
            serde_json::from_str(&data)
                .map_err(|e| format!("Failed to parse directories.json: {}", e))?
        } else {
            Vec::new()
        };

        Ok(Self {
            config_path,
            directories,
        })
    }

    pub fn list(&self) -> &[RegisteredDirectory] {
        &self.directories
    }

    pub fn register(&mut self, path: PathBuf, label: String, color: String) -> Result<RegisteredDirectory, String> {
        let canonical = path.canonicalize()
            .map_err(|e| format!("Invalid path: {}", e))?;

        if !canonical.is_dir() {
            return Err("Path is not a directory".into());
        }

        // Check for duplicates
        if self.directories.iter().any(|d| d.path == canonical) {
            return Err("Directory already registered".into());
        }

        let id = format!("{:x}", md5_hash(canonical.to_string_lossy().as_bytes()));
        let position = self.directories.len() as u32;

        let dir = RegisteredDirectory {
            id,
            path: canonical,
            label,
            color,
            position,
        };

        self.directories.push(dir.clone());
        self.save()?;

        Ok(dir)
    }

    pub fn unregister(&mut self, id: &str) -> Result<(), String> {
        let len_before = self.directories.len();
        self.directories.retain(|d| d.id != id);

        if self.directories.len() == len_before {
            return Err("Directory not found".into());
        }

        // Recompute positions
        for (i, dir) in self.directories.iter_mut().enumerate() {
            dir.position = i as u32;
        }

        self.save()
    }

    fn save(&self) -> Result<(), String> {
        let data = serde_json::to_string_pretty(&self.directories)
            .map_err(|e| format!("Failed to serialize: {}", e))?;
        fs::write(&self.config_path, data)
            .map_err(|e| format!("Failed to write directories.json: {}", e))
    }
}

/// Simple hash for generating directory IDs
fn md5_hash(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &byte in data {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}
