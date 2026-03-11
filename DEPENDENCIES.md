# Onyx — Dependencies & Reference

Researched packages, crates, and reference projects to avoid reinventing the wheel.

---

## Rust Backend (`Cargo.toml`)

| Category | Crate | Version | Why |
|----------|-------|---------|-----|
| SQLite | `rusqlite` + `bundled` feature | 0.38 | Sync, thin C wrapper, FTS5 included with `bundled`. Skip tauri-plugin-sql — Rust owns the data layer |
| Migrations | `rusqlite_migration` | 1 | Uses SQLite's `user_version` pragma. No tracking table overhead |
| File watching | `notify` + `notify-debouncer-full` | 8.2 / 0.5 | Industry standard (rust-analyzer, deno, cargo-watch). Debouncer adds file ID tracking |
| YAML | `serde_yaml_ng` | 0.10 | ⚠️ `serde_yaml` is deprecated, `serde_yml` has RustSec advisory (RUSTSEC-2025-0068). This is the maintained fork |
| Markdown | `pulldown-cmark` | 0.12 | Has **native `[[wikilink]]` support** (`ENABLE_WIKILINKS`). Streaming iterator, no AST allocation |
| Templates | `minijinja` | 2 | 10x faster compile than handlebars/tera. `{{ var }}` syntax. By Armin Ronacher (Flask/Jinja2 creator) |
| MCP server | `rmcp` + `axum` | 0.16 / 0.8 | Official Rust MCP SDK. Streamable HTTP transport built-in. Axum fits naturally in Tauri's tokio runtime |
| Dir traversal | `ignore` | 0.4 | From ripgrep — combines walkdir + .gitignore filtering in one. Also has parallel walker |
| OS trash | `trash` | 5.2 | Cross-platform native trash (macOS, Windows, FreeDesktop) |
| Fuzzy search | `nucleo-matcher` | 0.3 | From Helix editor, ~6x faster than fuzzy-matcher |
| Dates | `chrono` | 0.4 | Ecosystem standard. `NaiveDate` for periodic note paths (`%Y-%m-%d`) |
| CPU parallelism | `rayon` | 1.10 | Work-stealing thread pool for background indexing. Tokio for async I/O, rayon for CPU-bound |
| Serialization | `serde` + `derive` | 1 | Used by nearly everything above |

### Concurrency Pattern

- **tokio** (provided by Tauri) — async I/O, channels, timers, file watching event loop
- **rayon** — CPU-bound work (parsing thousands of markdown files during indexing)
- **tokio::sync::mpsc** + `app_handle.emit()` — Rust-to-frontend event emission
- Do NOT use `tokio::spawn_blocking` for CPU-heavy work — it starves the blocking thread pool

---

## Frontend (`package.json`)

| Category | Package | Size (gzip) | Why |
|----------|---------|-------------|-----|
| Editor | `@codemirror/lang-markdown` + `@lezer/markdown` | ~30kB | Core CM6 markdown. GFM tables, tasks, code blocks included |
| Frontmatter | `@codemirror/lang-yaml` | ~5kB | `yamlFrontmatter()` wrapper — handles `---` blocks natively |
| Code highlighting | `@codemirror/language-data` | lazy | 50+ languages loaded on demand inside fenced code blocks |
| Wikilinks/tags | `lezer-markdown-obsidian` | tiny | Lezer extensions for `[[links]]`, `#tags`, `![[embeds]]`, `==highlights==` |
| Search/replace | `@codemirror/search` | ~5kB | Regex, case sensitivity, whole word. Included in basicSetup |
| Theme reference | `@codemirror/theme-one-dark` | ~3kB | Structural reference for building our custom dark theme |
| File tree | `@headless-tree/react` | ~10kB | Headless, 100k+ item virtualization, async data. Successor to react-complex-tree |
| Tab reorder | `@dnd-kit/sortable` | ~10kB | Drag-to-reorder tabs. Tab bar itself is custom (~50 lines) |
| Context menu | `@radix-ui/react-context-menu` | ~6kB | Accessible, unstyled, works with plain CSS |
| Command palette | `cmdk` | ~7kB | Headless, used by Vercel/Linear/Raycast. Built on Radix |
| Dialogs | `@radix-ui/react-dialog` | ~5kB | Shares internals with context menu (Radix) |
| Calendar | `react-day-picker` | ~8kB | Zero deps, headless, custom modifiers for dot indicators on days with notes |
| Split panes | `react-resizable-panels` | ~12kB | By bvaughn (React core team). CSS-based, collapsible panels |
| Toasts | `sonner` | ~3kB | `toast.promise()` for indexing progress, MCP write confirmations |
| Dates | `date-fns` (tree-shaken) | ~4kB | Functional, tree-shakes to just what you import |
| Keyboard shortcuts | `react-hotkeys-hook` | ~3kB | `useHotkeys('mod+o', handler)` — `mod` = Cmd on Mac, Ctrl on Windows |
| State | `zustand` 5 + persist/immer/devtools middleware | ~5kB | All middleware ships built-in as of v5 |

**Total frontend library overhead: ~73kB gzipped** (~200-250kB decompressed)

### CM6 Notes

- **Wikilink/tag parsing:** `lezer-markdown-obsidian` gives us the parser layer. The decoration/widget layer (hiding markup in live preview, rendering checkboxes, interactive tables) is always custom CM6 extensions.
- **Live preview:** Use CM6's `Decoration.replace()` + `ViewPlugin` to hide markup when cursor is outside the node. Study `codemirror-rich-markdoc` for the pattern.
- **Table editing:** No standalone CM6 package exists. Zettlr built a custom `TableEditor` module — study theirs.
- **Outliner (indent/outdent):** No standalone package. Typically 50-100 lines of keymap code.
- **Word count / cursor position:** Custom `ViewPlugin`, ~30 lines.
- **Auto-save:** `EditorView.updateListener.of(update => { if (update.docChanged) debouncedSave() })`.
- **Vim mode:** `@replit/codemirror-vim` if we ever want it (Tier 2+).

---

## Tauri 2 Plugins (Official)

| Plugin | NPM Package | Purpose |
|--------|-------------|---------|
| File System | `@tauri-apps/plugin-fs` | Built-in file access with scoped permissions |
| Global Shortcuts | `@tauri-apps/plugin-global-shortcut` | OS-level shortcuts (when window unfocused) |
| Clipboard | `@tauri-apps/plugin-clipboard-manager` | Text read/write |
| Store | `@tauri-apps/plugin-store` | Persistent key-value storage for settings |
| Window State | `@tauri-apps/plugin-window-state` | Persist/restore window size & position across launches |
| Single Instance | `@tauri-apps/plugin-single-instance` | Prevent duplicate app instances |
| Dialog | `@tauri-apps/plugin-dialog` | Native file open/save dialogs |
| Updater | `@tauri-apps/plugin-updater` | Auto-update via GitHub Releases (later) |

### Titlebar

Tauri v2 native: set `decorations: false` in `tauri.conf.json`, use `data-tauri-drag-region` on HTML elements. Optional: `tauri-controls` for native-looking window buttons per OS.

### System Tray

Core Tauri feature (not a plugin). Enable `tray-icon` feature flag, use `TrayIconBuilder`.

---

## Key Findings

1. **`serde_yaml` is dead** — must use `serde_yaml_ng` (original deprecated, first fork has security advisory)
2. **pulldown-cmark has native `[[wikilink]]` support** — `Options::ENABLE_WIKILINKS`, no custom Rust parser needed
3. **`lezer-markdown-obsidian`** gives CM6 wikilink + tag + embed parsing — saves significant frontend work
4. **Official Rust MCP SDK exists** (`rmcp`) with streamable HTTP transport — no manual protocol implementation
5. **`minijinja`** is 10x faster than alternatives for template compilation — perfect for `{{date}}` substitution
6. **`nucleo-matcher`** (from Helix) is ~6x faster than fuzzy-matcher — great for quick open

---

## Reference Projects

Ranked by direct relevance to Onyx.

### Near-Identical Stack

| Project | Stack | Stars | Study For | URL |
|---------|-------|-------|-----------|-----|
| **Lumina Note** | Tauri v2 + React 18 + CM6 + Zustand + SQLite | 727 | CM6 live markdown, wikilinks, three editor modes, database views | https://github.com/blueberrycongee/Lumina-Note |
| **Otterly** | Tauri + Svelte + SQLite FTS5 + ProseMirror | 108 | Hexagonal architecture, FTS5 search, wikilink + backlink tracking | https://github.com/ajkdrag/otterly |

### CM6 Editor References

| Project | Stack | Stars | Study For | URL |
|---------|-------|-------|-----------|-----|
| **Zettlr** | Electron + CM6 + TypeScript + Vue 3 | 12.6k | Best CM6 editor setup — `editor-extension-sets.ts`, renderers, table editor | https://github.com/Zettlr/Zettlr |
| **MarkEdit** | Swift/macOS + CM6 in WKWebView | 3.8k | Native app + CM6 webview hybrid (similar to Tauri approach), handles 10MB files | https://github.com/MarkEdit-app/MarkEdit |
| **ink-mde** | TypeScript + CM6, framework-agnostic | 292 | Clean, minimal CM6 setup with GFM, hybrid preview, vim mode | https://github.com/davidmyersdev/ink-mde |
| **SilverBullet** | Deno + CM6 + Preact + Lua | 4.8k | CM6 + lightweight frontend, query language over markdown, indexing | https://github.com/silverbulletmd/silverbullet |
| **codemirror-rich-markdoc** | CM6 extension | ~100 | Live preview pattern — hiding markup via `Decoration.replace()` | https://github.com/segphault/codemirror-rich-markdoc |
| **lezer-markdown-obsidian** | Lezer parser extensions | 7 | Wikilink, tag, embed, highlight parser nodes for CM6 | https://github.com/erykwalder/lezer-markdown-obsidian |

### Architecture Patterns

| Project | Stack | Stars | Study For | URL |
|---------|-------|-------|-----------|-----|
| **Otterly** | Tauri + Svelte + SQLite FTS5 + ProseMirror | 108 | Best Rust backend of all candidates. See "Otterly Deep Dive" below | https://github.com/ajkdrag/otterly |
| **AppFlowy** | Flutter + Rust | 68.5k | Rust backend architecture, event-driven frontend↔Rust communication | https://github.com/AppFlowy-IO/AppFlowy |
| **Anytype** | Electron + React + Go middleware | 7.2k | Typed objects system design (validates our `object-types.json` approach) | https://github.com/anyproto/anytype-ts |
| **HelixNotes** | Tauri 2 + SvelteKit + Tantivy | — | Full-text search via Tantivy, graph view, Obsidian import | https://codeberg.org/ArkHost/HelixNotes |

### Otterly Deep Dive — Rust Patterns to Reference

Otterly's frontend (Svelte + ProseMirror) is irrelevant to Onyx, but their Rust backend is the best-structured of all candidates evaluated. Specific files to study when implementing each phase:

**Phase 1 — File I/O & Watching:**
- `src-tauri/src/features/notes/service.rs` — Atomic writes (temp file + rename), conflict detection via mtime, path traversal protection (`reject_symlink_components`, `resolve_under_vault_root`). Proper security thinking.
- `src-tauri/src/features/watcher/service.rs` — Clean `notify` integration with event classification (note changes vs asset changes), excluded folder filtering, graceful shutdown via channel signaling.

**Phase 2 — SQLite Indexing & Search:**
- `src-tauri/src/features/search/db.rs` — FTS5 schema with BM25 ranking, batch indexing (100 files at a time), cancellation via `AtomicBool`, separate reader/writer connections. Worker thread per vault with mpsc command channel.
- Three-table design: `notes`, `notes_fts` (FTS5 virtual table), `outlinks`.

**Phase 3 — Links & Backlinks:**
- `src-tauri/src/features/search/link_parser.rs` — Extracts both `[[wikilinks]]` and `[markdown](links)` using comrak. Handles relative path resolution, link rewriting on file moves. Stores in `outlinks` table. `get_backlinks()` and `get_outlinks()` query the link graph. `suggest_planned()` finds unresolved links sorted by reference count.

**Architecture patterns worth adapting:**
- A1. **Atomic file writes**: Write to temp file, then rename. Prevents corruption on crash.
- A2. **Conflict detection**: Compare mtime before writing. If file changed on disk since last read, warn instead of overwriting.
- A3. **Path traversal protection**: Validate all paths resolve within registered directories. Prevents `../../etc/passwd` attacks via wikilinks or MCP.
- A4. **Batch indexing with cancellation**: Index in chunks of 100, check `AtomicBool` between batches. Allows aborting on shutdown or re-index request.
- A5. **Separate SQLite connections**: Reader connection (shared/WAL) + writer connection (exclusive). Reads never block on writes.
- A6. **Worker thread per vault**: Each registered directory gets its own indexing worker with an mpsc command channel. Clean shutdown via channel drop.
- A7. **Folder cache with TTL**: 30s TTL + LRU eviction for directory listings. Avoids hammering the filesystem.

### Obsidian Plugin Source (for feature implementation patterns)

| Plugin | Stars | Study For | URL |
|--------|-------|-----------|-----|
| **periodic-notes** | 1.3k | Date-to-filepath mapping, template application, calendar set management | https://github.com/liamcain/obsidian-periodic-notes |
| **dataview** | 8.6k | YAML frontmatter indexing, typed data model, query execution | https://github.com/blacksmithgu/obsidian-dataview |
| **outliner** | 1.3k | List manipulation operations, keyboard-driven indent/outdent/move | https://github.com/vslinko/obsidian-outliner |
| **calendar** | 2.1k | Calendar widget rendering. UI is a separate Svelte package | https://github.com/liamcain/obsidian-calendar-plugin |
| **calendar-ui** | — | Standalone Svelte calendar widget (adapt patterns to React) | https://github.com/liamcain/obsidian-calendar-ui |

### Other Tauri Note Apps

| Project | Stack | Stars | Notes | URL |
|---------|-------|-------|-------|-----|
| **NoteGen** | Tauri + Next.js + React | 11k | AI-enhanced notes with RAG/MCP. Shows Tauri can scale | https://github.com/codexu/note-gen |
| **Rhyolite** | Tauri + Rust-heavy | 180 | Primarily Rust markdown editor | https://github.com/lockedmutex/rhyolite |
| **Open Note** | Tauri + React + TypeScript + TipTap | — | React+Tauri patterns, PDF export | https://github.com/JeremiasVillane/open-note |

### Cautionary Tales

| Project | Stars | Lesson | URL |
|---------|-------|--------|-----|
| **Notable** | 23.6k | Proved demand for "markdown files + YAML frontmatter + tags". Went closed-source, community backlash | https://github.com/notable/notable |
| **MarkText** | 54.4k | Built custom editor engine (Muya) instead of using CM6 — maintenance burden killed the project | https://github.com/marktext/marktext |

---

## Crate Reference (`Cargo.toml`)

```toml
# SQLite
rusqlite = { version = "0.38", features = ["bundled"] }
rusqlite_migration = "1"

# File watching
notify = "8.2"
notify-debouncer-full = "0.5"

# YAML frontmatter
serde_yaml_ng = "0.10"
serde = { version = "1", features = ["derive"] }

# Markdown parsing
pulldown-cmark = "0.12"

# Templates
minijinja = "2"

# MCP server
rmcp = { version = "0.16", features = ["transport-streamable-http-server", "server"] }
axum = "0.8"

# File utilities
ignore = "0.4"
trash = "5.2"

# Fuzzy search
nucleo-matcher = "0.3"

# Date/time
chrono = { version = "0.4", features = ["serde"] }

# Concurrency
rayon = "1.10"
tokio = { version = "1", features = ["sync"] }  # Tauri provides the runtime
```
