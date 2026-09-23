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
const SCHEMA_MIGRATIONS: &[&str] = &[
    // 1: pending links resolve case-insensitively, like every other wikilink lookup
    "CREATE INDEX IF NOT EXISTS idx_links_target_nocase ON links(target COLLATE NOCASE);",
];

/// A wikilink target's file id, or None. Title (file stem) matches win and ties go to
/// the first path alphabetically, the same rule `resolve_by_title` uses for clicks, so
/// backlinks and click-to-follow agree on which note a duplicate name means.
fn resolve_link_target(conn: &Connection, target: &str) -> Result<Option<i64>, String> {
    let id: Option<i64> = conn.query_row(
        "SELECT id FROM files WHERE title = ?1 COLLATE NOCASE ORDER BY path LIMIT 1",
        params![target],
        |row| row.get(0),
    ).optional().map_err(|e| format!("Failed to resolve link target: {}", e))?;
    if id.is_some() {
        return Ok(id);
    }

    // [[folder/note]] and [[note.md]] resolve by path suffix. Narrow by the last
    // segment's stem through the title index first; the unindexed scan remains only for
    // rows whose title is unset (a folder rename clears titles until reindex).
    let lower = target.to_ascii_lowercase();
    if !(target.contains('/') || lower.ends_with(".md")) {
        return Ok(None);
    }
    let last = target.rsplit('/').next().unwrap_or(target);
    let stem = if last.to_ascii_lowercase().ends_with(".md") { &last[..last.len() - 3] } else { last };
    let escaped = escape_like_literal(target);
    let suffix_match = "(path LIKE '%/' || ?1 || '.md' ESCAPE '\\' OR path LIKE '%/' || ?1 ESCAPE '\\')";
    let id: Option<i64> = conn.query_row(
        &format!("SELECT id FROM files WHERE title = ?2 COLLATE NOCASE AND {suffix_match} ORDER BY path LIMIT 1"),
        params![escaped, stem],
        |row| row.get(0),
    ).optional().map_err(|e| format!("Failed to resolve link target: {}", e))?;
    if id.is_some() {
        return Ok(id);
    }
    conn.query_row(
        &format!("SELECT id FROM files WHERE title IS NULL AND {suffix_match} ORDER BY path LIMIT 1"),
        params![escaped],
        |row| row.get(0),
    ).optional().map_err(|e| format!("Failed to resolve link target: {}", e))
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

fn replace_links(conn: &Connection, file_id: i64, links: &[LinkRecord]) -> Result<(), String> {
    conn.execute("DELETE FROM links WHERE source_id = ?1", params![file_id])
        .map_err(|e| format!("Failed to delete old links: {}", e))?;
    for link in links {
        let target_id = resolve_link_target(conn, &link.target)?;
        conn.execute(
            "INSERT INTO links (source_id, target, target_id, line_number, context)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![file_id, link.target, target_id, link.line_number, link.context],
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

        let db = Self { conn };
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
        for (i, sql) in SCHEMA_MIGRATIONS.iter().enumerate().skip(version) {
            let tx = self.conn.unchecked_transaction()
                .map_err(|e| format!("Failed to begin migration {}: {}", i + 1, e))?;
            tx.execute_batch(sql)
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

        self.conn.execute(
            "UPDATE files SET path = ?1, title = ?2 WHERE path = ?3",
            params![new_path, new_title, old_path],
        ).map_err(|e| format!("Failed to rename file in index: {}", e))?;
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
        self.conn.execute("DELETE FROM files WHERE path = ?1", params![path])
            .map_err(|e| format!("Failed to delete file: {}", e))?;
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

    pub fn set_links(&self, file_id: i64, links: &[LinkRecord]) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        replace_links(&tx, file_id, links)?;
        tx.commit().map_err(|e| format!("Failed to commit links: {}", e))?;
        Ok(())
    }

    pub fn set_tags(&self, file_id: i64, tags: &[String]) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;
        replace_tags(&tx, file_id, tags)?;
        tx.commit().map_err(|e| format!("Failed to commit tags: {}", e))?;
        Ok(())
    }

    /// Index one parsed file: its row, links and tags, and any links elsewhere that were
    /// waiting for it, in a single transaction, so a bulk reindex pays one commit per
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
        replace_links(&tx, file_id, links)?;
        replace_tags(&tx, file_id, tags)?;
        if let Some(t) = title {
            self.resolve_pending_links(t, file_id, path)?;
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

    pub fn get_backlinks(&self, path: &str) -> Result<Vec<BacklinkRecord>, String> {
        // Find the file's title (filename without .md) for matching
        let filename = Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let mut stmt = self.conn.prepare(
            "SELECT f.path, f.title, l.line_number, l.context
             FROM links l
             JOIN files f ON f.id = l.source_id
             WHERE l.target = ?1 OR l.target = ?2
             ORDER BY f.title ASC"
        ).map_err(|e| format!("Failed to prepare backlinks query: {}", e))?;

        let rows = stmt.query_map(params![filename, path], |row| {
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

    /// Path a clicked wikilink opens: a title (file stem) match first, then a path
    /// suffix for rows whose title is unset, ties going to the first path alphabetically.
    /// Two lookups rather than one OR, so the common case uses the title index.
    pub fn resolve_by_title(&self, title: &str) -> Result<Option<String>, String> {
        let by_title: Option<String> = self.conn.query_row(
            "SELECT path FROM files WHERE title = ?1 COLLATE NOCASE ORDER BY path LIMIT 1",
            params![title],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Failed to resolve wikilink: {}", e))?;
        if by_title.is_some() {
            return Ok(by_title);
        }
        self.conn.query_row(
            "SELECT path FROM files WHERE path LIKE '%/' || ?1 || '.md' ESCAPE '\\' ORDER BY path LIMIT 1",
            params![escape_like_literal(title)],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Failed to resolve wikilink: {}", e))
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
    /// Point links that were waiting for a note at it once it is indexed. A link waits
    /// when its source is indexed before its target, which a full reindex does for about
    /// half of all links. Matches the rules `resolve_link_target` uses: the title (file
    /// stem), or a `[[folder/note]]` / `[[note.md]]` target that is a suffix of the path.
    /// The suffix test only runs on waiting links whose target ends in this stem.
    pub fn resolve_pending_links(&self, file_title: &str, file_id: i64, path: &str) -> Result<u32, String> {
        let count = self.conn.execute(
            "UPDATE links SET target_id = ?1
             WHERE target_id IS NULL AND (
               target = ?2 COLLATE NOCASE
               OR ((target LIKE '%/' || ?3 ESCAPE '\\' OR target LIKE '%/' || ?3 || '.md' ESCAPE '\\'
                    OR target LIKE ?3 || '.md' ESCAPE '\\')
                   AND (lower(?4) LIKE '%/' || lower(target) || '.md' OR lower(?4) LIKE '%/' || lower(target)))
             )",
            params![file_id, file_title, escape_like_literal(file_title), path],
        ).map_err(|e| format!("Failed to resolve pending links: {}", e))?;
        Ok(count as u32)
    }

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

    fn temp_db() -> (Database, std::path::PathBuf) {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("onyx-db-test-{}-{}", std::process::id(), n));
        let db = Database::new(&dir.join("index.db")).unwrap();
        (db, dir)
    }

    fn link(target: &str) -> LinkRecord {
        LinkRecord { target: target.into(), line_number: Some(1), context: None }
    }

    fn add(db: &Database, path: &str, links: &[LinkRecord]) -> i64 {
        let stem = Path::new(path).file_stem().unwrap().to_string_lossy().to_string();
        db.index_file(path, "d", Some(&stem), Some(0), None, links, &[]).unwrap()
    }

    fn target_of(db: &Database, source: i64) -> Option<i64> {
        db.conn.query_row(
            "SELECT target_id FROM links WHERE source_id = ?1", params![source], |r| r.get(0),
        ).unwrap()
    }

    #[test]
    fn migrations_record_the_schema_version_and_rerun_cleanly() {
        let (db, dir) = temp_db();
        let v: i64 = db.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, SCHEMA_MIGRATIONS.len());
        drop(db);
        let again = Database::new(&dir.join("index.db")).unwrap();
        let v: i64 = again.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, SCHEMA_MIGRATIONS.len());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn backlinks_and_clicks_pick_the_same_note_for_a_duplicate_name() {
        let (db, dir) = temp_db();
        add(&db, "/v/b/Idea.md", &[]);
        let first = add(&db, "/v/a/Idea.md", &[]);
        let src = add(&db, "/v/src.md", &[link("idea")]);
        assert_eq!(target_of(&db, src), Some(first));
        assert_eq!(db.resolve_by_title("idea").unwrap().as_deref(), Some("/v/a/Idea.md"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn subpath_and_extension_targets_resolve_by_suffix() {
        let (db, dir) = temp_db();
        add(&db, "/v/x/Note.md", &[]);
        let wanted = add(&db, "/v/y/Note.md", &[]);
        let src = add(&db, "/v/s.md", &[link("y/Note")]);
        assert_eq!(target_of(&db, src), Some(wanted));
        let src2 = add(&db, "/v/s2.md", &[link("y/Note.md")]);
        assert_eq!(target_of(&db, src2), Some(wanted));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_pending_link_resolves_case_insensitively_when_its_note_appears() {
        let (db, dir) = temp_db();
        let src = add(&db, "/v/s.md", &[link("daily")]);
        assert_eq!(target_of(&db, src), None);
        let daily = add(&db, "/v/Daily.md", &[]);
        assert_eq!(target_of(&db, src), Some(daily));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_pending_folder_path_link_resolves_when_its_note_appears() {
        let (db, dir) = temp_db();
        let src = add(&db, "/v/Hub.md", &[link("Notes/Consent"), link("Consent.md"), link("Other/Consent")]);
        let consent = add(&db, "/v/Notes/Consent.md", &[]);
        let targets: Vec<(String, Option<i64>)> = {
            let mut stmt = db.conn.prepare(
                "SELECT target, target_id FROM links WHERE source_id = ?1 ORDER BY id").unwrap();
            stmt.query_map(params![src], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
                .map(|r| r.unwrap()).collect()
        };
        assert_eq!(targets, vec![
            ("Notes/Consent".to_string(), Some(consent)),
            ("Consent.md".to_string(), Some(consent)),
            ("Other/Consent".to_string(), None),
        ]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_click_finds_a_note_whose_title_was_cleared_by_a_folder_rename() {
        let (db, dir) = temp_db();
        add(&db, "/v/old/Plan.md", &[]);
        db.rename_dir_prefix("/v/old", "/v/new").unwrap();
        assert_eq!(db.resolve_by_title("Plan").unwrap().as_deref(), Some("/v/new/Plan.md"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
