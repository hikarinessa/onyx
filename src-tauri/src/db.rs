use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

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

impl Database {
    pub fn new(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create database directory: {}", e))?;
        }

        let conn = Connection::open(path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // Enable WAL mode and foreign keys
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
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
            CREATE INDEX IF NOT EXISTS idx_links_target ON links(target);
            CREATE INDEX IF NOT EXISTS idx_links_target_id ON links(target_id);
            CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
            CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
            CREATE INDEX IF NOT EXISTS idx_tags_file ON tags(file_id);
            CREATE INDEX IF NOT EXISTS idx_bookmarks_file ON bookmarks(file_id);"
        ).map_err(|e| format!("Failed to run migrations: {}", e))?;

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

    pub fn delete_file(&self, path: &str) -> Result<(), String> {
        self.conn.execute("DELETE FROM files WHERE path = ?1", params![path])
            .map_err(|e| format!("Failed to delete file: {}", e))?;
        Ok(())
    }

    pub fn delete_by_dir(&self, dir_id: &str) -> Result<u32, String> {
        let count = self.conn.execute("DELETE FROM files WHERE dir_id = ?1", params![dir_id])
            .map_err(|e| format!("Failed to delete files for directory: {}", e))?;
        Ok(count as u32)
    }

    pub fn set_links(&self, file_id: i64, links: &[LinkRecord]) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        tx.execute("DELETE FROM links WHERE source_id = ?1", params![file_id])
            .map_err(|e| format!("Failed to delete old links: {}", e))?;

        for link in links {
            // Try to resolve target_id by matching the link target against file paths/titles
            let target_id: Option<i64> = tx.query_row(
                "SELECT id FROM files WHERE path LIKE '%/' || ?1 || '.md' OR path LIKE '%/' || ?1 OR title = ?1 LIMIT 1",
                params![link.target],
                |row| row.get(0),
            ).optional().map_err(|e| format!("Failed to resolve link target: {}", e))?;

            tx.execute(
                "INSERT INTO links (source_id, target, target_id, line_number, context)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![file_id, link.target, target_id, link.line_number, link.context],
            ).map_err(|e| format!("Failed to insert link: {}", e))?;
        }

        tx.commit().map_err(|e| format!("Failed to commit links: {}", e))?;
        Ok(())
    }

    pub fn set_tags(&self, file_id: i64, tags: &[String]) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        tx.execute("DELETE FROM tags WHERE file_id = ?1", params![file_id])
            .map_err(|e| format!("Failed to delete old tags: {}", e))?;

        for tag in tags {
            tx.execute(
                "INSERT INTO tags (file_id, tag) VALUES (?1, ?2)",
                params![file_id, tag],
            ).map_err(|e| format!("Failed to insert tag: {}", e))?;
        }

        tx.commit().map_err(|e| format!("Failed to commit tags: {}", e))?;
        Ok(())
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

    pub fn get_file_id(&self, path: &str) -> Result<Option<i64>, String> {
        let result = self.conn.query_row(
            "SELECT id FROM files WHERE path = ?1",
            params![path],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Failed to get file id: {}", e))?;

        Ok(result)
    }

    pub fn resolve_by_title(&self, title: &str) -> Result<Option<String>, String> {
        let result = self.conn.query_row(
            "SELECT path FROM files WHERE title = ?1 COLLATE NOCASE OR path LIKE '%/' || ?1 || '.md' ORDER BY (title = ?1 COLLATE NOCASE) DESC, path ASC LIMIT 1",
            params![title],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Failed to resolve wikilink: {}", e))?;

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
