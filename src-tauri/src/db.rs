use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

/// Escape LIKE metacharacters so literal `_` and `%` in paths don't act as wildcards.
/// Query sites must include `ESCAPE '\\'`.
fn escape_like_literal(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

pub struct Database {
    conn: Connection,
    /// Registered directory roots in sidebar order, for root-relative `[[folder/note]]`
    /// links. Kept in step with the directory list by `set_roots`.
    roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileRecord {
    pub id: i64,
    pub path: String,
    pub dir_id: String,
    pub title: Option<String>,
    pub modified_at: Option<i64>,
    pub frontmatter: Option<String>,
}

/// Lightweight result for quick-open search — no frontmatter payload
#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LinkRecord {
    pub target: String,
    pub line_number: Option<i32>,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BacklinkRecord {
    pub source_path: String,
    pub source_title: Option<String>,
    pub line_number: Option<i32>,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagInfo {
    pub tag: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexStats {
    pub total_files: u32,
    pub total_links: u32,
    pub total_tags: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct BookmarkRecord {
    pub path: String,
    pub title: Option<String>,
    pub label: Option<String>,
}

/// Schema changes on top of the base tables, oldest first (see `run_migrations`).
/// Entry n brings the database to version n + 1. Once released, append; never edit.
const SCHEMA_MIGRATIONS: &[fn(&Connection) -> Result<(), String>] = &[
    add_link_target_stem,
];

/// 1: `links.target_stem`, the lowercased note name a link can resolve to, indexed so
/// every link naming a note is one lookup away when that note is indexed or removed.
fn add_link_target_stem(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "ALTER TABLE links ADD COLUMN target_stem TEXT;
         CREATE INDEX IF NOT EXISTS idx_links_target_stem ON links(target_stem);",
    ).map_err(|e| e.to_string())?;
    let rows: Vec<(i64, String)> = {
        let mut stmt = conn.prepare("SELECT id, target FROM links").map_err(|e| e.to_string())?;
        let mapped = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
        mapped.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    for (id, target) in rows {
        conn.execute("UPDATE links SET target_stem = ?1 WHERE id = ?2", params![link_stem(&target), id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The note name a link target can only resolve to: its last path segment, without
/// `.md`, lowercased. `[[Notes/Consent]]` and `[[consent.md]]` both give `consent`.
fn link_stem(target: &str) -> String {
    let base = target.strip_suffix(".md").unwrap_or(target);
    base.rsplit('/').next().unwrap_or(base).to_lowercase()
}

fn parent_dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// Where a wikilink written in a note in `source_dir` points. The single rule behind
/// backlinks, click-to-follow, broken-link dimming and rename rewriting, so none of them
/// can disagree about a link. In order:
///   1. `[[folder/note]]` relative to a registered root, roots in sidebar order
///   2. the note's name in the linking note's own folder (`[[sub/note]]` relative to it)
///   3. any note with that name, the first path alphabetically
///   4. `[[folder/note]]` as the tail of any path, first alphabetically
/// Names match case-insensitively for ASCII letters, as SQLite's NOCASE does. Every
/// candidate carries the link's last segment as its title, so the title index finds
/// them and the rest is plain string comparison: no link text is ever a LIKE pattern.
fn resolve_link(
    conn: &Connection,
    roots: &[String],
    target: &str,
    source_dir: &str,
) -> Result<Option<(i64, String)>, String> {
    let base = target.strip_suffix(".md").unwrap_or(target);
    let stem = base.rsplit('/').next().unwrap_or(base);
    if stem.is_empty() {
        return Ok(None);
    }
    let candidates: Vec<(i64, String)> = {
        let mut stmt = conn.prepare_cached(
            "SELECT id, path FROM files WHERE title = ?1 COLLATE NOCASE ORDER BY path",
        ).map_err(|e| format!("Failed to resolve link target: {}", e))?;
        let rows = stmt.query_map(params![stem], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("Failed to resolve link target: {}", e))?;
        rows.collect::<Result<_, _>>().map_err(|e| format!("Failed to resolve link target: {}", e))?
    };
    let at = |path: &str| candidates.iter().find(|(_, p)| p.eq_ignore_ascii_case(path)).cloned();

    let nested = base.contains('/');
    if nested {
        for root in roots {
            if let Some(hit) = at(&format!("{}/{}.md", root.trim_end_matches('/'), base)) {
                return Ok(Some(hit));
            }
        }
    }
    if let Some(hit) = at(&format!("{}/{}.md", source_dir, base)) {
        return Ok(Some(hit));
    }
    if !nested {
        return Ok(candidates.into_iter().next());
    }
    let tail = format!("/{}.md", base);
    Ok(candidates.into_iter().find(|(_, p)| {
        p.len() >= tail.len() && p[p.len() - tail.len()..].eq_ignore_ascii_case(&tail)
    }))
}

/// Re-resolve every link whose name is `stem`, after a note with that name appeared,
/// moved or went away. A link resolved earlier may now have a better target (the new
/// note sorts first, or sits in the linking note's folder), not just a missing one.
fn reresolve_links_named(conn: &Connection, roots: &[String], stem: &str) -> Result<(), String> {
    let links: Vec<(i64, String, String, Option<i64>)> = {
        let mut stmt = conn.prepare_cached(
            "SELECT l.id, l.target, s.path, l.target_id
             FROM links l JOIN files s ON s.id = l.source_id
             WHERE l.target_stem = ?1",
        ).map_err(|e| format!("Failed to find links to re-resolve: {}", e))?;
        let rows = stmt.query_map(params![stem], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| format!("Failed to find links to re-resolve: {}", e))?;
        rows.collect::<Result<_, _>>().map_err(|e| format!("Failed to find links to re-resolve: {}", e))?
    };
    for (id, target, source_path, current) in links {
        let resolved = resolve_link(conn, roots, &target, parent_dir(&source_path))?.map(|(id, _)| id);
        if resolved != current {
            conn.execute("UPDATE links SET target_id = ?1 WHERE id = ?2", params![resolved, id])
                .map_err(|e| format!("Failed to update link target: {}", e))?;
        }
    }
    Ok(())
}

fn replace_tags(conn: &Connection, file_id: i64, tags: &[String]) -> Result<(), String> {
    conn.execute("DELETE FROM tags WHERE file_id = ?1", params![file_id])
        .map_err(|e| format!("Failed to delete old tags: {}", e))?;
    for tag in tags {
        conn.execute(
            "INSERT INTO tags (file_id, tag) VALUES (?1, ?2)",
            params![file_id, tag],
        ).map_err(|e| format!("Failed to insert tag: {}", e))?;
    }
    Ok(())
}

fn replace_links(
    conn: &Connection,
    roots: &[String],
    file_id: i64,
    source_path: &str,
    links: &[LinkRecord],
) -> Result<(), String> {
    conn.execute("DELETE FROM links WHERE source_id = ?1", params![file_id])
        .map_err(|e| format!("Failed to delete old links: {}", e))?;
    let source_dir = parent_dir(source_path);
    for link in links {
        let target_id = resolve_link(conn, roots, &link.target, source_dir)?.map(|(id, _)| id);
        conn.execute(
            "INSERT INTO links (source_id, target, target_stem, target_id, line_number, context)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![file_id, link.target, link_stem(&link.target), target_id, link.line_number, link.context],
        ).map_err(|e| format!("Failed to insert link: {}", e))?;
    }
    Ok(())
}

impl Database {
    pub fn new(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create database directory: {}", e))?;
        }

        let conn = Connection::open(path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // WAL with synchronous = NORMAL syncs at checkpoints rather than on every
        // commit. A power cut can lose the last few commits but never corrupts the
        // file, and this database is a cache the indexer rebuilds from the notes.
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;"
        ).map_err(|e| format!("Failed to set pragmas: {}", e))?;

        let db = Self { conn, roots: Vec::new() };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<(), String> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS files (
                id          INTEGER PRIMARY KEY,
                path        TEXT UNIQUE NOT NULL,
                dir_id      TEXT NOT NULL,
                title       TEXT,
                modified_at INTEGER,
                indexed_at  INTEGER,
                frontmatter TEXT
            );

            CREATE TABLE IF NOT EXISTS links (
                id          INTEGER PRIMARY KEY,
                source_id   INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                target      TEXT NOT NULL,
                target_id   INTEGER REFERENCES files(id) ON DELETE SET NULL,
                line_number INTEGER,
                context     TEXT
            );

            CREATE TABLE IF NOT EXISTS tags (
                id          INTEGER PRIMARY KEY,
                file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                tag         TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS object_types (
                id          INTEGER PRIMARY KEY,
                name        TEXT UNIQUE NOT NULL,
                properties  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bookmarks (
                id          INTEGER PRIMARY KEY,
                file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                label       TEXT,
                position    INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_files_dir ON files(dir_id);
            CREATE INDEX IF NOT EXISTS idx_files_title ON files(title);
            CREATE INDEX IF NOT EXISTS idx_files_title_nocase ON files(title COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_links_target ON links(target);
            CREATE INDEX IF NOT EXISTS idx_links_target_id ON links(target_id);
            CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
            CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
            CREATE INDEX IF NOT EXISTS idx_tags_file ON tags(file_id);
            CREATE INDEX IF NOT EXISTS idx_bookmarks_file ON bookmarks(file_id);"
        ).map_err(|e| format!("Failed to run migrations: {}", e))?;

        // Changes to an existing schema, applied in order and tracked in user_version:
        // entry n brings the database to version n + 1. Append, never edit or reorder.
        let version: usize = self.conn
            .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
            .map_err(|e| format!("Failed to read schema version: {}", e))? as usize;
        for (i, migrate) in SCHEMA_MIGRATIONS.iter().enumerate().skip(version) {
            let tx = self.conn.unchecked_transaction()
                .map_err(|e| format!("Failed to begin migration {}: {}", i + 1, e))?;
            migrate(&tx)
                .map_err(|e| format!("Failed to apply migration {}: {}", i + 1, e))?;
            tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))
                .map_err(|e| format!("Failed to record migration {}: {}", i + 1, e))?;
            tx.commit().map_err(|e| format!("Failed to commit migration {}: {}", i + 1, e))?;
        }

        Ok(())
    }

    pub fn upsert_file(
        &self,
        path: &str,
        dir_id: &str,
        title: Option<&str>,
        modified_at: Option<i64>,
        frontmatter_json: Option<&str>,
    ) -> Result<i64, String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        self.conn.execute(
            "INSERT INTO files (path, dir_id, title, modified_at, indexed_at, frontmatter)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(path) DO UPDATE SET
                dir_id = excluded.dir_id,
                title = excluded.title,
                modified_at = excluded.modified_at,
                indexed_at = excluded.indexed_at,
                frontmatter = excluded.frontmatter",
            params![path, dir_id, title, modified_at, now, frontmatter_json],
        ).map_err(|e| format!("Failed to upsert file: {}", e))?;

        // Return the file id
        let file_id: i64 = self.conn.query_row(
            "SELECT id FROM files WHERE path = ?1",
            params![path],
            |row| row.get(0),
        ).map_err(|e| format!("Failed to get file id: {}", e))?;

        Ok(file_id)
    }

    pub fn rename_file(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        let new_title = std::path::Path::new(new_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string());

        let old_title = Path::new(old_path).file_stem().map(|s| s.to_string_lossy().to_lowercase());
        let tx = self.conn.unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        tx.execute(
            "UPDATE files SET path = ?1, title = ?2 WHERE path = ?3",
            params![new_path, new_title, old_path],
        ).map_err(|e| format!("Failed to rename file in index: {}", e))?;
        // Links to the old name may now point elsewhere; links to the new name may now
        // point here.
        for stem in [old_title, new_title.map(|t| t.to_lowercase())].into_iter().flatten() {
            reresolve_links_named(&tx, &self.roots, &stem)?;
        }
        tx.commit().map_err(|e| format!("Failed to commit rename: {}", e))?;
        Ok(())
    }

    /// Rename all files under a directory prefix (used for folder renames).
    /// Updates paths and recalculates titles for all affected files.
    pub fn rename_dir_prefix(&self, old_prefix: &str, new_prefix: &str) -> Result<u32, String> {
        let old_p = if old_prefix.ends_with('/') { old_prefix.to_string() } else { format!("{}/", old_prefix) };
        let new_p = if new_prefix.ends_with('/') { new_prefix.to_string() } else { format!("{}/", new_prefix) };

        let old_pattern = format!("{}%", escape_like_literal(&old_p));
        let new_pattern = format!("{}%", escape_like_literal(&new_p));

        let tx = self.conn.unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        let count = tx.execute(
            "UPDATE files SET path = ?1 || substr(path, ?2), title = NULL WHERE path LIKE ?3 ESCAPE '\\'",
            params![new_p, old_p.len() as i64 + 1, old_pattern],
        ).map_err(|e| format!("Failed to rename directory prefix: {}", e))?;

        // Recalculate titles for affected files
        let mut stmt = tx.prepare(
            "SELECT id, path FROM files WHERE path LIKE ?1 ESCAPE '\\'"
        ).map_err(|e| format!("Failed to prepare title update: {}", e))?;

        let rows: Vec<(i64, String)> = stmt.query_map(params![new_pattern], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).map_err(|e| format!("Failed to query files: {}", e))?
          .filter_map(|r| r.ok())
          .collect();
        drop(stmt);

        for (id, path) in &rows {
            let title = std::path::Path::new(path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string());
            tx.execute(
                "UPDATE files SET title = ?1 WHERE id = ?2",
                params![title, id],
            ).map_err(|e| format!("Failed to update title: {}", e))?;
        }

        tx.commit().map_err(|e| format!("Failed to commit dir rename: {}", e))?;
        Ok(count as u32)
    }

    pub fn delete_file(&self, path: &str) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        tx.execute("DELETE FROM files WHERE path = ?1", params![path])
            .map_err(|e| format!("Failed to delete file: {}", e))?;
        // Links that pointed here may have another note of the same name to go to
        if let Some(stem) = Path::new(path).file_stem() {
            reresolve_links_named(&tx, &self.roots, &stem.to_string_lossy().to_lowercase())?;
        }
        tx.commit().map_err(|e| format!("Failed to commit delete: {}", e))?;
        Ok(())
    }

    /// Delete all files whose path starts with a given prefix (used for folder deletes).
    pub fn delete_by_prefix(&self, prefix: &str) -> Result<u32, String> {
        let escaped = escape_like_literal(prefix);
        let pattern = if escaped.ends_with('/') { format!("{}%", escaped) } else { format!("{}/%", escaped) };
        let count = self.conn.execute(
            "DELETE FROM files WHERE path LIKE ?1 ESCAPE '\\'",
            params![pattern],
        ).map_err(|e| format!("Failed to delete files by prefix: {}", e))?;
        Ok(count as u32)
    }

    pub fn delete_by_dir(&self, dir_id: &str) -> Result<u32, String> {
        let count = self.conn.execute("DELETE FROM files WHERE dir_id = ?1", params![dir_id])
            .map_err(|e| format!("Failed to delete files for directory: {}", e))?;
        Ok(count as u32)
    }

    /// Replace the registered roots used for root-relative links. Call whenever the
    /// directory list changes; the order is the sidebar's.
    pub fn set_roots(&mut self, roots: Vec<String>) {
        self.roots = roots;
    }

    /// Where a wikilink written in `source_path` points, as a path. Clicks use this, so
    /// they follow exactly what backlinks and rename rewriting use.
    pub fn resolve_link_path(&self, target: &str, source_path: &str) -> Result<Option<String>, String> {
        Ok(resolve_link(&self.conn, &self.roots, target, parent_dir(source_path))?.map(|(_, p)| p))
    }

    /// Index one parsed file: its row, links and tags, and every link elsewhere that names
    /// it (see `reresolve_links_named`), in a single transaction, so a bulk reindex pays one commit per
    /// file and readers never see its links without its row.
    pub fn index_file(
        &self,
        path: &str,
        dir_id: &str,
        title: Option<&str>,
        modified_at: Option<i64>,
        frontmatter_json: Option<&str>,
        links: &[LinkRecord],
        tags: &[String],
    ) -> Result<i64, String> {
        let tx = self.conn.unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        let file_id = self.upsert_file(path, dir_id, title, modified_at, frontmatter_json)?;
        replace_links(&tx, &self.roots, file_id, path, links)?;
        replace_tags(&tx, file_id, tags)?;
        if let Some(t) = title {
            reresolve_links_named(&tx, &self.roots, &t.to_lowercase())?;
        }
        tx.commit().map_err(|e| format!("Failed to commit index of {}: {}", path, e))?;
        Ok(file_id)
    }

    pub fn search_files(&self, query: &str) -> Result<Vec<SearchResult>, String> {
        // Escape LIKE metacharacters so %, _, and \ are treated as literals
        let escaped = query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let pattern = format!("%{}%", escaped);
        let mut stmt = self.conn.prepare(
            "SELECT path, title
             FROM files
             WHERE title LIKE ?1 ESCAPE '\\' OR path LIKE ?1 ESCAPE '\\'
             ORDER BY title ASC
             LIMIT 50"
        ).map_err(|e| format!("Failed to prepare search: {}", e))?;

        let rows = stmt.query_map(params![pattern], |row| {
            Ok(SearchResult {
                path: row.get(0)?,
                title: row.get(1)?,
            })
        }).map_err(|e| format!("Failed to execute search: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }

        Ok(results)
    }

    /// Links that resolve to `path`, by the same rule as clicks (`resolve_link`).
    pub fn get_backlinks(&self, path: &str) -> Result<Vec<BacklinkRecord>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT f.path, f.title, l.line_number, l.context
             FROM links l
             JOIN files f ON f.id = l.source_id
             JOIN files t ON t.id = l.target_id
             WHERE t.path = ?1
             ORDER BY f.title ASC"
        ).map_err(|e| format!("Failed to prepare backlinks query: {}", e))?;

        let rows = stmt.query_map(params![path], |row| {
            Ok(BacklinkRecord {
                source_path: row.get(0)?,
                source_title: row.get(1)?,
                line_number: row.get(2)?,
                context: row.get(3)?,
            })
        }).map_err(|e| format!("Failed to execute backlinks query: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Failed to read backlink row: {}", e))?);
        }

        Ok(results)
    }

    /// For a given target file id, return every (source file path, link target string)
    /// pair where a wikilink resolves to that file. Excludes self-references.
    /// Used by `rename_file` to know which files reference the renamed file and
    /// what literal target text to substitute in each one.
    pub fn get_link_targets_to(&self, target_id: i64) -> Result<Vec<(String, String)>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT f.path, l.target
             FROM links l
             JOIN files f ON f.id = l.source_id
             WHERE l.target_id = ?1 AND f.id != ?1"
        ).map_err(|e| format!("Failed to prepare link-targets query: {}", e))?;

        let rows = stmt.query_map(params![target_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| format!("Failed to execute link-targets query: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }
        Ok(results)
    }

    pub fn get_file_id(&self, path: &str) -> Result<Option<i64>, String> {
        let result = self.conn.query_row(
            "SELECT id FROM files WHERE path = ?1",
            params![path],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Failed to get file id: {}", e))?;

        Ok(result)
    }

    pub fn add_bookmark(&self, file_id: i64, label: Option<&str>, position: Option<i32>) -> Result<(), String> {
        // Remove existing bookmark first (enforce one bookmark per file)
        self.conn.execute("DELETE FROM bookmarks WHERE file_id = ?1", params![file_id])
            .map_err(|e| format!("Failed to remove existing bookmark: {}", e))?;

        self.conn.execute(
            "INSERT INTO bookmarks (file_id, label, position) VALUES (?1, ?2, ?3)",
            params![file_id, label, position],
        ).map_err(|e| format!("Failed to add bookmark: {}", e))?;

        Ok(())
    }

    pub fn remove_bookmark(&self, file_id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM bookmarks WHERE file_id = ?1", params![file_id])
            .map_err(|e| format!("Failed to remove bookmark: {}", e))?;

        Ok(())
    }

    pub fn get_bookmarks(&self) -> Result<Vec<BookmarkRecord>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT f.path, f.title, b.label
             FROM bookmarks b
             JOIN files f ON f.id = b.file_id
             ORDER BY b.position ASC, f.title ASC"
        ).map_err(|e| format!("Failed to prepare bookmarks query: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok(BookmarkRecord {
                path: row.get(0)?,
                title: row.get(1)?,
                label: row.get(2)?,
            })
        }).map_err(|e| format!("Failed to execute bookmarks query: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Failed to read bookmark row: {}", e))?);
        }

        Ok(results)
    }

    pub fn is_bookmarked(&self, file_id: i64) -> Result<bool, String> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM bookmarks WHERE file_id = ?1",
            params![file_id],
            |row| row.get(0),
        ).map_err(|e| format!("Failed to check bookmark: {}", e))?;

        Ok(count > 0)
    }

    /// Extract bookmarks as (path, label) pairs for migration to JSON storage.
    pub fn get_bookmarks_for_migration(&self) -> Result<Vec<(String, Option<String>)>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT f.path, b.label
             FROM bookmarks b
             JOIN files f ON f.id = b.file_id
             ORDER BY b.position ASC, f.title ASC"
        ).map_err(|e| format!("Failed to prepare migration query: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        }).map_err(|e| format!("Failed to execute migration query: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Failed to read migration row: {}", e))?);
        }
        Ok(results)
    }

    pub fn is_path_bookmarked(&self, path: &str) -> Result<bool, String> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM bookmarks b JOIN files f ON f.id = b.file_id WHERE f.path = ?1",
            params![path],
            |row| row.get(0),
        ).map_err(|e| format!("Failed to check bookmark by path: {}", e))?;
        Ok(count > 0)
    }

    pub fn query_by_type(&self, type_name: &str) -> Result<Vec<SearchResult>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT path, title FROM files
             WHERE json_extract(frontmatter, '$.type') = ?1 COLLATE NOCASE
             ORDER BY title ASC"
        ).map_err(|e| format!("Failed to prepare query_by_type: {}", e))?;

        let rows = stmt.query_map(params![type_name], |row| {
            Ok(SearchResult {
                path: row.get(0)?,
                title: row.get(1)?,
            })
        }).map_err(|e| format!("Failed to execute query_by_type: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }
        Ok(results)
    }

    pub fn update_frontmatter(&self, path: &str, frontmatter_json: &str) -> Result<(), String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        self.conn.execute(
            "UPDATE files SET frontmatter = ?1, indexed_at = ?2 WHERE path = ?3",
            params![frontmatter_json, now, path],
        ).map_err(|e| format!("Failed to update frontmatter: {}", e))?;
        Ok(())
    }

    pub fn get_frontmatter(&self, path: &str) -> Result<Option<String>, String> {
        let result = self.conn.query_row(
            "SELECT frontmatter FROM files WHERE path = ?1",
            params![path],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Failed to get frontmatter: {}", e))?;

        Ok(result)
    }

    /// Get all unique tags with usage counts (for autocomplete)
    pub fn get_all_tags(&self) -> Result<Vec<TagInfo>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT tag, COUNT(*) as cnt FROM tags GROUP BY tag ORDER BY cnt DESC, tag ASC"
        ).map_err(|e| format!("Failed to prepare tags query: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok(TagInfo {
                tag: row.get(0)?,
                count: row.get(1)?,
            })
        }).map_err(|e| format!("Failed to execute tags query: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Failed to read tag row: {}", e))?);
        }
        Ok(results)
    }

    /// Get all file titles for wikilink autocomplete
    pub fn get_all_titles(&self) -> Result<Vec<SearchResult>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT path, title FROM files ORDER BY title ASC"
        ).map_err(|e| format!("Failed to prepare titles query: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok(SearchResult {
                path: row.get(0)?,
                title: row.get(1)?,
            })
        }).map_err(|e| format!("Failed to execute titles query: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Failed to read title row: {}", e))?);
        }
        Ok(results)
    }

    /// Count incoming links to a file (for delete confirmation)
    pub fn count_incoming_links(&self, path: &str) -> Result<u32, String> {
        let filename = Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let count: u32 = self.conn.query_row(
            "SELECT COUNT(DISTINCT l.source_id)
             FROM links l
             JOIN files f ON f.id = l.source_id
             WHERE (l.target = ?1 OR l.target = ?2) AND f.path != ?2",
            params![filename, path],
            |row| row.get(0),
        ).map_err(|e| format!("Failed to count incoming links: {}", e))?;

        Ok(count)
    }

    /// Resolve pending backlinks when a new file is created.
    /// Finds links with target_id = NULL that match the new file's title, and sets target_id.
    /// Get all indexed file paths with their indexed_at timestamps (for startup reconciliation).
    pub fn get_all_indexed_paths(&self) -> Result<Vec<(String, Option<i64>)>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT path, indexed_at FROM files"
        ).map_err(|e| format!("Failed to prepare indexed paths query: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?))
        }).map_err(|e| format!("Failed to query indexed paths: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Failed to read indexed path row: {}", e))?);
        }
        Ok(results)
    }

    /// Get indexed file paths with their indexed_at timestamps under a directory
    /// prefix (for scoped reconciliation).
    pub fn get_indexed_paths_by_prefix(&self, prefix: &str) -> Result<Vec<(String, Option<i64>)>, String> {
        let pattern = format!("{}%", escape_like_literal(prefix));
        let mut stmt = self.conn.prepare(
            "SELECT path, indexed_at FROM files WHERE path LIKE ?1 ESCAPE '\\'"
        ).map_err(|e| format!("Failed to prepare prefix paths query: {}", e))?;

        let rows = stmt.query_map(params![pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?))
        }).map_err(|e| format!("Failed to query prefix paths: {}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| format!("Failed to read path row: {}", e))?);
        }
        Ok(results)
    }

    /// Check if any indexed .md file exists under the given directory path.
    pub fn has_files_under(&self, dir_path: &str) -> bool {
        let escaped = escape_like_literal(dir_path);
        let pattern = if escaped.ends_with('/') {
            format!("{}%", escaped)
        } else {
            format!("{}/%", escaped)
        };
        self.conn
            .query_row(
                "SELECT 1 FROM files WHERE path LIKE ?1 ESCAPE '\\' LIMIT 1",
                params![pattern],
                |_| Ok(()),
            )
            .is_ok()
    }

    /// Batch delete files by path. More efficient than individual deletes for reconciliation.
    pub fn delete_files_batch(&self, paths: &[String]) -> Result<u32, String> {
        if paths.is_empty() {
            return Ok(0);
        }
        let tx = self.conn.unchecked_transaction()
            .map_err(|e| format!("Failed to begin batch delete transaction: {}", e))?;

        let mut total = 0u32;
        for path in paths {
            let count = tx.execute("DELETE FROM files WHERE path = ?1", params![path])
                .map_err(|e| format!("Failed to delete file {}: {}", path, e))?;
            total += count as u32;
        }

        tx.commit().map_err(|e| format!("Failed to commit batch delete: {}", e))?;
        Ok(total)
    }

    pub fn get_stats(&self) -> Result<IndexStats, String> {
        let total_files: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM files", [], |row| row.get(0),
        ).map_err(|e| format!("Failed to count files: {}", e))?;

        let total_links: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM links", [], |row| row.get(0),
        ).map_err(|e| format!("Failed to count links: {}", e))?;

        let total_tags: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM tags", [], |row| row.get(0),
        ).map_err(|e| format!("Failed to count tags: {}", e))?;

        Ok(IndexStats {
            total_files,
            total_links,
            total_tags,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A database file in a fresh temp dir, removed on drop.
    struct TempDb {
        db: Database,
        dir: std::path::PathBuf,
    }
    impl Drop for TempDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
    impl std::ops::Deref for TempDb {
        type Target = Database;
        fn deref(&self) -> &Database { &self.db }
    }

    fn temp_db(roots: &[&str]) -> TempDb {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("onyx-db-test-{}-{}", std::process::id(), n));
        let mut db = Database::new(&dir.join("index.db")).unwrap();
        db.set_roots(roots.iter().map(|r| r.to_string()).collect());
        TempDb { db, dir }
    }

    fn link(target: &str) -> LinkRecord {
        LinkRecord { target: target.into(), line_number: Some(1), context: None }
    }

    fn add(db: &Database, path: &str, links: &[&str]) -> i64 {
        let stem = Path::new(path).file_stem().unwrap().to_string_lossy().to_string();
        let links: Vec<LinkRecord> = links.iter().map(|t| link(t)).collect();
        db.index_file(path, "d", Some(&stem), Some(0), None, &links, &[]).unwrap()
    }

    /// Where the index recorded `source`'s only link as pointing.
    fn recorded(db: &Database, source: i64) -> Option<String> {
        db.conn.query_row(
            "SELECT t.path FROM links l LEFT JOIN files t ON t.id = l.target_id WHERE l.source_id = ?1",
            params![source], |r| r.get(0),
        ).unwrap()
    }

    /// Recorded target, click target and backlink membership must all name the same note.
    fn assert_agree(db: &Database, source: i64, source_path: &str, target: &str, want: Option<&str>) {
        assert_eq!(recorded(db, source).as_deref(), want, "recorded target");
        assert_eq!(db.resolve_link_path(target, source_path).unwrap().as_deref(), want, "click target");
        if let Some(w) = want {
            let back = db.get_backlinks(w).unwrap();
            assert!(back.iter().any(|b| b.source_path == source_path), "backlink on {w}");
        }
    }

    #[test]
    fn migrations_record_the_schema_version_and_rerun_cleanly() {
        let t = temp_db(&[]);
        let v: i64 = t.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, SCHEMA_MIGRATIONS.len());
        let again = Database::new(&t.dir.join("index.db")).unwrap();
        let v: i64 = again.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, SCHEMA_MIGRATIONS.len());
    }

    #[test]
    fn a_duplicate_name_resolves_to_the_first_path_whichever_is_indexed_first() {
        let t = temp_db(&[]);
        add(&t, "/v/c/Idea.md", &[]);
        let src = add(&t, "/v/src.md", &["idea"]);
        assert_agree(&t, src, "/v/src.md", "idea", Some("/v/c/Idea.md"));
        // An earlier-sorting duplicate indexed after the link takes it over
        add(&t, "/v/a/Idea.md", &[]);
        assert_agree(&t, src, "/v/src.md", "idea", Some("/v/a/Idea.md"));
        // and the link moves on when that note goes away
        t.delete_file("/v/a/Idea.md").unwrap();
        assert_agree(&t, src, "/v/src.md", "idea", Some("/v/c/Idea.md"));
    }

    #[test]
    fn a_note_in_the_linking_notes_folder_wins_over_the_first_path() {
        let t = temp_db(&[]);
        add(&t, "/v/a/Idea.md", &[]);
        add(&t, "/v/b/Idea.md", &[]);
        let src = add(&t, "/v/b/src.md", &["Idea"]);
        assert_agree(&t, src, "/v/b/src.md", "Idea", Some("/v/b/Idea.md"));
        let back_a = t.get_backlinks("/v/a/Idea.md").unwrap();
        assert!(back_a.is_empty(), "the other duplicate gets no backlink");
    }

    #[test]
    fn a_folder_path_resolves_from_a_root_before_any_other_tail_match() {
        let t = temp_db(&["/v"]);
        add(&t, "/v/x/Notes/Consent.md", &[]);
        let wanted = "/v/Notes/Consent.md";
        add(&t, wanted, &[]);
        let src = add(&t, "/v/y/src.md", &["Notes/Consent"]);
        assert_agree(&t, src, "/v/y/src.md", "Notes/Consent", Some(wanted));
    }

    #[test]
    fn a_folder_path_falls_back_to_any_path_ending_in_it() {
        let t = temp_db(&["/elsewhere"]);
        add(&t, "/v/y/Note.md", &[]);
        let src = add(&t, "/v/s.md", &["y/Note.md"]);
        assert_agree(&t, src, "/v/s.md", "y/Note.md", Some("/v/y/Note.md"));
    }

    #[test]
    fn a_waiting_link_resolves_when_its_note_appears_whatever_the_case_or_folder_form() {
        let t = temp_db(&["/v"]);
        let a = add(&t, "/v/a.md", &["daily"]);
        let b = add(&t, "/v/b.md", &["Notes/Consent"]);
        assert_eq!(recorded(&t, a), None);
        assert_eq!(recorded(&t, b), None);
        add(&t, "/v/Daily.md", &[]);
        add(&t, "/v/Notes/Consent.md", &[]);
        assert_agree(&t, a, "/v/a.md", "daily", Some("/v/Daily.md"));
        assert_agree(&t, b, "/v/b.md", "Notes/Consent", Some("/v/Notes/Consent.md"));
    }

    #[test]
    fn underscores_and_percents_in_a_link_are_literal() {
        let t = temp_db(&[]);
        add(&t, "/v/aXb/Consent.md", &[]);
        add(&t, "/v/100X/Plan.md", &[]);
        let s1 = add(&t, "/v/s1.md", &["a_b/Consent"]);
        let s2 = add(&t, "/v/s2.md", &["100%/Plan"]);
        assert_agree(&t, s1, "/v/s1.md", "a_b/Consent", None);
        assert_agree(&t, s2, "/v/s2.md", "100%/Plan", None);
    }

    #[test]
    fn renaming_a_note_moves_the_links_that_named_it() {
        let t = temp_db(&[]);
        add(&t, "/v/Old.md", &[]);
        add(&t, "/v/z/New.md", &[]);
        let to_old = add(&t, "/v/s1.md", &["Old"]);
        let to_new = add(&t, "/v/s2.md", &["New"]);
        t.rename_file("/v/Old.md", "/v/New.md").unwrap();
        assert_agree(&t, to_old, "/v/s1.md", "Old", None);
        assert_agree(&t, to_new, "/v/s2.md", "New", Some("/v/New.md"));
    }

    #[test]
    fn re_resolution_uses_the_stem_index() {
        let t = temp_db(&[]);
        let plan: String = t.conn.query_row(
            "EXPLAIN QUERY PLAN SELECT l.id FROM links l WHERE l.target_stem = 'x'", [],
            |r| r.get(3),
        ).unwrap();
        assert!(plan.contains("idx_links_target_stem"), "{plan}");
    }
}
