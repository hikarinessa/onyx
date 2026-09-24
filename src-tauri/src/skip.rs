//! Folders Onyx never indexes, watches, or lists.
//!
//! One rule set shared by the indexer walk, the file watcher, and `list_directory`, so the
//! three surfaces cannot disagree about what exists. A folder skipped here produces no index
//! rows, no `fs:change` events, and no tree entry.

use std::path::Path;

/// Names skipped wherever they appear.
const SKIPPED_NAMES: &[&str] = &[".obsidian", ".git", "node_modules", ".DS_Store", ".trash"];

/// Claude Code data folders, skipped when they sit directly under a `.claude` folder.
/// `worktrees` holds full agent checkouts — thousands of notes each, created and deleted in
/// bursts — and the rest are churn-heavy state with no markdown content. `.claude` itself
/// stays visible for skills, agents and project notes.
const CLAUDE_INTERNAL: &[&str] = &[
    "worktrees",
    "file-history",
    "telemetry",
    "todos",
    "agent-state",
    "session-env",
    "paste-cache",
    "backups",
    "shell-snapshots",
    "tasks",
    "statsig",
    "sessions",
    "ide",
    "debug",
    "cache",
];

/// Whether a directory entry called `name`, inside a folder called `parent`, is skipped.
/// Dot-folders are skipped except `.claude`; pass `None` for `parent` at a registered root.
pub fn is_skipped_entry(name: &str, parent: Option<&str>) -> bool {
    if SKIPPED_NAMES.contains(&name) {
        return true;
    }
    if parent == Some(".claude") && CLAUDE_INTERNAL.contains(&name) {
        return true;
    }
    name.starts_with('.') && name != ".claude"
}

/// Files the tree lists and the watcher reports: notes, canvases (JSON Canvas), plus the
/// plain text kinds the editor opens in Source mode (see src/lib/fileKinds.ts). Notes and
/// canvases are indexed (`indexer::is_indexed_file`).
pub const LISTED_EXTENSIONS: &[&str] = &["md", "canvas", "txt", "json", "yaml", "yml"];

pub fn is_listed_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| LISTED_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Whether any component of `relative` — a path below a registered root — is skipped.
pub fn is_skipped_path(relative: &Path) -> bool {
    let names: Vec<&str> = relative.iter().filter_map(|c| c.to_str()).collect();
    names.iter().enumerate().any(|(i, name)| {
        let parent = if i > 0 { Some(names[i - 1]) } else { None };
        is_skipped_entry(name, parent)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_fixed_names_anywhere() {
        assert!(is_skipped_entry(".git", None));
        assert!(is_skipped_entry("node_modules", Some("backend")));
        assert!(is_skipped_entry(".trash", Some("Notes")));
        assert!(!is_skipped_entry("Notes", None));
    }

    #[test]
    fn keeps_dot_claude_but_skips_other_dot_folders() {
        assert!(!is_skipped_entry(".claude", None));
        assert!(is_skipped_entry(".obsidian", None));
        assert!(is_skipped_entry(".hidden", Some("Notes")));
    }

    #[test]
    fn skips_claude_internals_only_directly_under_dot_claude() {
        assert!(is_skipped_entry("worktrees", Some(".claude")));
        assert!(is_skipped_entry("todos", Some(".claude")));
        assert!(!is_skipped_entry("skills", Some(".claude")));
        assert!(!is_skipped_entry("worktrees", Some("docs")));
        assert!(!is_skipped_entry("tasks", Some("Projects")));
    }

    #[test]
    fn skipped_path_checks_every_component() {
        assert!(is_skipped_path(Path::new(".claude/worktrees/agent-1/docs/spec.md")));
        assert!(is_skipped_path(Path::new("backend/deps/mint/README.md")) == false);
        assert!(is_skipped_path(Path::new("app/node_modules/x/README.md")));
        assert!(!is_skipped_path(Path::new(".claude/skills/spec/SKILL.md")));
        assert!(!is_skipped_path(Path::new("docs/worktrees/plan.md")));
        assert!(!is_skipped_path(Path::new("Notes/daily.md")));
    }

    #[test]
    fn canvases_are_listed_alongside_notes() {
        assert!(is_listed_file(Path::new("/v/Boards/plan.canvas")));
        assert!(is_listed_file(Path::new("/v/Boards/Plan.CANVAS")));
        assert!(is_listed_file(Path::new("/v/note.md")));
        assert!(!is_listed_file(Path::new("/v/photo.png")));
    }
}
