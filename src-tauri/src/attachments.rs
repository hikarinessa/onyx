//! Images referenced from notes. `![[photo.png]]` names a file anywhere in the
//! registered folders (Obsidian-style), so resolving it needs a file-name lookup the
//! markdown index doesn't keep: images are never indexed.
//!
//! The lookup is built on first use by walking the roots with the shared skip rules, and
//! rebuilt when a name isn't found or a found file has gone (not more often than every
//! few seconds), so it follows files added or moved outside Onyx without the watcher.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use walkdir::WalkDir;

pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "heic"];

const MIN_REBUILD_INTERVAL: Duration = Duration::from_secs(3);

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

#[derive(Default)]
pub struct AttachmentIndex {
    /// Lowercased file name → every image with that name, sorted by path
    by_name: HashMap<String, Vec<PathBuf>>,
    built: Option<Instant>,
}

impl AttachmentIndex {
    fn rebuild(&mut self, roots: &[PathBuf]) {
        let mut by_name: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for root in roots {
            for entry in WalkDir::new(root)
                .into_iter()
                .filter_entry(|e| !crate::indexer::is_ignored(e))
                .filter_map(|e| e.ok())
            {
                let path = entry.path();
                if entry.file_type().is_file() && is_image(path) {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    by_name.entry(name).or_default().push(path.to_path_buf());
                }
            }
        }
        for paths in by_name.values_mut() {
            paths.sort();
        }
        self.by_name = by_name;
        self.built = Some(Instant::now());
    }

    fn lookup(&self, file_name: &str, tail: &str) -> Option<PathBuf> {
        let tail = tail.to_lowercase();
        self.by_name.get(&file_name.to_lowercase())?
            .iter()
            .find(|p| p.to_string_lossy().to_lowercase().ends_with(&tail) && p.is_file())
            .cloned()
    }

    /// The first image, by path, named `file_name` whose path ends in `tail`
    /// (`/photo.png`, or `/pics/photo.png` for a link with a folder).
    pub fn find(&mut self, file_name: &str, tail: &str, roots: &[PathBuf]) -> Option<PathBuf> {
        if self.built.is_some() {
            if let Some(hit) = self.lookup(file_name, tail) {
                return Some(hit);
            }
        }
        let stale = self.built.is_none_or(|t| t.elapsed() >= MIN_REBUILD_INTERVAL);
        if !stale {
            return None;
        }
        self.rebuild(roots);
        self.lookup(file_name, tail)
    }
}

/// Where an image reference written in a note in `context_dir` points, in the order
/// wikilinks use: an absolute path, a folder path from a registered root, the note's own
/// folder (relative paths too), then the file name anywhere in the roots, first path
/// alphabetically. Only existing files under a registered root are returned.
pub fn resolve(
    reference: &str,
    context_dir: &Path,
    roots: &[PathBuf],
    index: &mut AttachmentIndex,
) -> Option<PathBuf> {
    let reference = reference.trim();
    if reference.is_empty() {
        return None;
    }
    let under_root = |p: &Path| roots.iter().any(|r| p.starts_with(r));
    let existing = |p: PathBuf| -> Option<PathBuf> {
        let canonical = p.canonicalize().ok()?;
        (canonical.is_file() && under_root(&canonical)).then_some(canonical)
    };

    if reference.starts_with('/') {
        return existing(PathBuf::from(reference));
    }
    if reference.contains('/') {
        for root in roots {
            if let Some(hit) = existing(root.join(reference)) {
                return Some(hit);
            }
        }
    }
    if let Some(hit) = existing(context_dir.join(reference)) {
        return Some(hit);
    }

    let file_name = reference.rsplit('/').next().unwrap_or(reference);
    let tail = format!("/{}", reference.trim_start_matches("./"));
    index.find(file_name, &tail, roots)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn vault() -> (PathBuf, PathBuf) {
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("onyx-attach-{}-{}", std::process::id(), n));
        for (p, body) in [
            ("Notes/note.md", "x"),
            ("Notes/local.png", "img"),
            ("Attachments/2024/Photo.PNG", "img"),
            ("Attachments/2025/Photo.png", "img"),
            ("Attachments/2025/other.jpg", "img"),
            (".git/hidden.png", "img"),
        ] {
            let full = root.join(p);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, body).unwrap();
        }
        let canonical = root.canonicalize().unwrap();
        (canonical.clone(), canonical.join("Notes"))
    }

    #[test]
    fn resolves_by_folder_then_name_anywhere_first_path_wins() {
        let (root, notes) = vault();
        let roots = vec![root.clone()];
        let mut idx = AttachmentIndex::default();
        assert_eq!(resolve("local.png", &notes, &roots, &mut idx), Some(notes.join("local.png")));
        assert_eq!(resolve("photo.png", &notes, &roots, &mut idx), Some(root.join("Attachments/2024/Photo.PNG")));
        assert_eq!(resolve("2025/photo.png", &notes, &roots, &mut idx), Some(root.join("Attachments/2025/Photo.png")));
        assert_eq!(resolve("Attachments/2025/other.jpg", &notes, &roots, &mut idx), Some(root.join("Attachments/2025/other.jpg")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn skipped_folders_and_paths_outside_the_roots_are_not_served() {
        let (root, notes) = vault();
        let roots = vec![root.clone()];
        let mut idx = AttachmentIndex::default();
        assert_eq!(resolve("hidden.png", &notes, &roots, &mut idx), None);
        assert_eq!(resolve("../../../../etc/hosts", &notes, &roots, &mut idx), None);
        assert_eq!(resolve("/etc/hosts", &notes, &roots, &mut idx), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_file_added_later_is_found_after_the_rebuild_interval() {
        let (root, notes) = vault();
        let roots = vec![root.clone()];
        let mut idx = AttachmentIndex::default();
        assert_eq!(resolve("new.gif", &notes, &roots, &mut idx), None);
        fs::write(root.join("Attachments/new.gif"), "img").unwrap();
        idx.built = Some(Instant::now() - MIN_REBUILD_INTERVAL);
        assert_eq!(resolve("new.gif", &notes, &roots, &mut idx), Some(root.join("Attachments/new.gif")));
        fs::remove_dir_all(root).unwrap();
    }
}
