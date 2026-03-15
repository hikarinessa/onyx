use crate::db::Database;
use crate::indexer::Indexer;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::Emitter;

const SELF_WRITE_COOLDOWN: Duration = Duration::from_secs(2);
const INDEX_DEBOUNCE: Duration = Duration::from_secs(3);

/// Events emitted to the frontend
#[derive(Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub kind: String, // "create", "modify", "remove", "rename"
    pub path: String,
    pub old_path: Option<String>,
    pub is_dir: bool,
}

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
    /// Tracks recently written paths to suppress self-write events
    recent_writes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
    /// Shutdown flag for the debounce processor thread
    shutdown: Arc<AtomicBool>,
    /// Handle to the debounce processor thread (joined on drop)
    debounce_thread: Option<JoinHandle<()>>,
}

impl FileWatcher {
    pub fn new(
        app: tauri::AppHandle,
        paths: &[PathBuf],
        db: Arc<Mutex<Database>>,
        dir_pairs: Vec<(String, PathBuf)>,
    ) -> Result<Self, String> {
        let recent_writes: Arc<Mutex<HashMap<PathBuf, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let writes_ref = recent_writes.clone();
        let app_ref = app.clone();

        // Debounce map: path -> scheduled reindex time
        let pending_reindex: Arc<Mutex<HashMap<PathBuf, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let pending_ref = pending_reindex.clone();

        // Rescan map: directory path -> scheduled reconciliation time
        let pending_rescan: Arc<Mutex<HashMap<PathBuf, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let rescan_ref = pending_rescan.clone();
        let rescan_debounce = pending_rescan.clone();

        // Shutdown flag — set to true when FileWatcher is dropped
        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown_ref = shutdown.clone();

        // Spawn a debounce processor thread
        let db_debounce = db.clone();
        let dirs_debounce = dir_pairs.clone();
        let debounce_thread = std::thread::spawn(move || {
            while !shutdown_ref.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(500));

                let now = Instant::now();
                let mut ready: Vec<(PathBuf, String)> = Vec::new();

                {
                    let mut pending = pending_ref.lock().unwrap();
                    let mut to_remove = Vec::new();

                    for (path, scheduled) in pending.iter() {
                        if now >= *scheduled {
                            // Find which directory this file belongs to
                            let dir_id = dirs_debounce
                                .iter()
                                .find(|(_, dir_path)| path.starts_with(dir_path))
                                .map(|(id, _)| id.clone())
                                .unwrap_or_default();

                            ready.push((path.clone(), dir_id));
                            to_remove.push(path.clone());
                        }
                    }

                    for path in to_remove {
                        pending.remove(&path);
                    }
                }

                for (path, dir_id) in ready {
                    if path.exists() {
                        if let Err(e) = Indexer::reindex_file(&path, &dir_id, &db_debounce) {
                            log::error!("Failed to reindex {}: {}", path.display(), e);
                        }
                    } else {
                        if let Err(e) = Indexer::remove_file(&path, &db_debounce) {
                            log::error!("Failed to remove from index {}: {}", path.display(), e);
                        }
                    }
                }

                // Process pending rescan (directory reconciliation)
                let rescan_ready: Vec<(PathBuf, String)> = {
                    let mut pending = rescan_debounce.lock().unwrap();
                    let mut ready = Vec::new();
                    let mut to_remove = Vec::new();
                    for (path, scheduled) in pending.iter() {
                        if now >= *scheduled {
                            let dir_id = dirs_debounce
                                .iter()
                                .find(|(_, dir_path)| path.starts_with(dir_path))
                                .map(|(id, _)| id.clone())
                                .unwrap_or_default();
                            ready.push((path.clone(), dir_id));
                            to_remove.push(path.clone());
                        }
                    }
                    for path in to_remove {
                        pending.remove(&path);
                    }
                    ready
                };
                for (dir_path, dir_id) in rescan_ready {
                    log::info!("Running rescan reconciliation for {}", dir_path.display());
                    if let Err(e) = Indexer::reconcile_directory(&dir_path, &dir_id, &db_debounce) {
                        log::error!("Rescan reconciliation failed for {}: {}", dir_path.display(), e);
                    }
                }
            }
            log::info!("Debounce processor thread exiting");
        });

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                let event = match res {
                    Ok(e) => e,
                    Err(e) => {
                        log::error!("Watch error: {}", e);
                        return;
                    }
                };

                // Handle Rescan events (FSEvents coalescing, inotify overflow).
                // Schedule a targeted reconciliation for each affected path.
                if matches!(event.kind, notify::EventKind::Other) {
                    log::warn!("Rescan event received — scheduling directory reconciliation");
                    for path in &event.paths {
                        let mut pending = rescan_ref.lock().unwrap();
                        pending.insert(
                            path.clone(),
                            Instant::now() + INDEX_DEBOUNCE,
                        );
                    }
                    return;
                }

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
                        notify::EventKind::Modify(notify::event::ModifyKind::Name(_)) => {
                            // Rename/move event (e.g. Finder move).
                            // Emit as create or remove based on whether the path still exists.
                            if path.exists() { "create" } else { "remove" }
                        }
                        notify::EventKind::Modify(_) => "modify",
                        notify::EventKind::Remove(_) => "remove",
                        _ => continue,
                    };

                    let change = FileChangeEvent {
                        kind: kind.to_string(),
                        path: path.to_string_lossy().to_string(),
                        old_path: None,
                        is_dir,
                    };

                    if let Err(e) = app_ref.emit("fs:change", &change) {
                        log::error!("Failed to emit fs:change: {}", e);
                    }

                    // Schedule reindex with debounce for .md files
                    if is_md {
                        let mut pending = pending_reindex.lock().unwrap();
                        pending.insert(
                            path.clone(),
                            Instant::now() + INDEX_DEBOUNCE,
                        );
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
            shutdown,
            debounce_thread: Some(debounce_thread),
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

impl Drop for FileWatcher {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(handle) = self.debounce_thread.take() {
            let _ = handle.join();
        }
    }
}
