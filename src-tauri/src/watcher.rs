use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

const SELF_WRITE_COOLDOWN: Duration = Duration::from_secs(2);

/// Events emitted to the frontend
#[derive(Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub kind: String, // "create", "modify", "remove"
    pub path: String,
}

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
    /// Tracks recently written paths to suppress self-write events
    recent_writes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl FileWatcher {
    pub fn new(app: tauri::AppHandle, paths: &[PathBuf]) -> Result<Self, String> {
        let recent_writes: Arc<Mutex<HashMap<PathBuf, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let writes_ref = recent_writes.clone();
        let app_ref = app.clone();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                let event = match res {
                    Ok(e) => e,
                    Err(e) => {
                        log::error!("Watch error: {}", e);
                        return;
                    }
                };

                for path in &event.paths {
                    // Skip non-markdown files for change events
                    let is_dir = path.is_dir();
                    let is_md = path.extension().map_or(false, |e| e == "md");
                    if !is_dir && !is_md {
                        continue;
                    }

                    // Suppress self-write events
                    {
                        let mut writes = writes_ref.lock().unwrap();
                        // Clean old entries
                        writes.retain(|_, t| t.elapsed() < SELF_WRITE_COOLDOWN);
                        if writes.contains_key(path) {
                            continue;
                        }
                    }

                    let kind = match event.kind {
                        notify::EventKind::Create(_) => "create",
                        notify::EventKind::Modify(_) => "modify",
                        notify::EventKind::Remove(_) => "remove",
                        _ => continue,
                    };

                    let change = FileChangeEvent {
                        kind: kind.to_string(),
                        path: path.to_string_lossy().to_string(),
                    };

                    if let Err(e) = app_ref.emit("fs:change", &change) {
                        log::error!("Failed to emit fs:change: {}", e);
                    }
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

        for path in paths {
            watcher
                .watch(path, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch {}: {}", path.display(), e))?;
        }

        Ok(Self {
            _watcher: watcher,
            recent_writes,
        })
    }

    /// Register a path as recently written by Onyx (suppresses next watcher event)
    pub fn mark_self_write(&self, path: &Path) {
        let mut writes = self.recent_writes.lock().unwrap();
        writes.insert(path.to_path_buf(), Instant::now());
    }

    /// Add a new directory to watch
    pub fn watch(&mut self, path: &Path) -> Result<(), String> {
        self._watcher
            .watch(path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch {}: {}", path.display(), e))
    }
}
