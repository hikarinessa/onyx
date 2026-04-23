use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT_MS: u64 = 5000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptInfo {
    pub name: String,
    pub path: String,
    pub display_name: String,
    pub palette: bool,
    pub timeout_ms: u64,
}

#[derive(Debug, Default, Clone, Deserialize)]
struct Sidecar {
    #[serde(default)]
    display: Option<String>,
    #[serde(default)]
    palette: Option<bool>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

fn scripts_dir() -> Result<PathBuf, String> {
    let dir = crate::paths::onyx_dir()?.join("scripts");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create scripts dir: {}", e))?;
    }
    Ok(dir)
}

pub fn list_scripts() -> Result<Vec<ScriptInfo>, String> {
    let dir = scripts_dir()?;
    let mut scripts = Vec::new();

    let entries = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(scripts),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if file_name.ends_with(".json") || file_name.starts_with('.') {
            continue;
        }

        let stem = path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&file_name)
            .to_string();

        let sidecar_path = dir.join(format!("{}.json", stem));
        let sidecar: Sidecar = if sidecar_path.exists() {
            std::fs::read_to_string(&sidecar_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            Sidecar::default()
        };

        scripts.push(ScriptInfo {
            name: stem.clone(),
            path: path.to_string_lossy().to_string(),
            display_name: sidecar.display.unwrap_or_else(|| stem.clone()),
            palette: sidecar.palette.unwrap_or(false),
            timeout_ms: sidecar.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS),
        });
    }

    scripts.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(scripts)
}

pub fn find_script(name: &str) -> Result<ScriptInfo, String> {
    list_scripts()?
        .into_iter()
        .find(|s| s.name == name)
        .ok_or_else(|| format!("Script not found: {}", name))
}

pub fn run_script(
    info: &ScriptInfo,
    args: &[String],
    env: &HashMap<String, String>,
) -> Result<String, String> {
    let child = Command::new(&info.path)
        .args(args)
        .envs(env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", info.name, e))?;

    let child = Arc::new(Mutex::new(Some(child)));
    let waiter_child = Arc::clone(&child);
    let (tx, rx) = std::sync::mpsc::channel();

    thread::spawn(move || {
        let taken = waiter_child.lock().ok().and_then(|mut g| g.take());
        if let Some(c) = taken {
            let _ = tx.send(c.wait_with_output());
        }
    });

    let timeout = Duration::from_millis(info.timeout_ms);
    let deadline = Instant::now() + timeout;

    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(output)) => {
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).to_string());
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    return Err(format!(
                        "Script '{}' exited {}: {}",
                        info.name,
                        output.status.code().unwrap_or(-1),
                        stderr.trim()
                    ));
                }
            }
            Ok(Err(e)) => return Err(format!("Script '{}' failed: {}", info.name, e)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if Instant::now() >= deadline {
                    if let Ok(mut guard) = child.lock() {
                        if let Some(mut c) = guard.take() {
                            let _ = c.kill();
                        }
                    }
                    return Err(format!(
                        "Script '{}' timed out after {}ms",
                        info.name, info.timeout_ms
                    ));
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err(format!("Script '{}' thread disconnected", info.name));
            }
        }
    }
}
