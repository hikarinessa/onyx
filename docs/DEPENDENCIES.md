# Onyx — Dependencies & Reference

Actual dependencies used in the project, with rationale. Updated for v0.10.3.

---

## Rust Backend (`Cargo.toml`)

| Category | Crate | Version | Why |
|----------|-------|---------|-----|
| SQLite | `rusqlite` + `bundled` feature | 0.33 | Sync, thin C wrapper. `bundled` includes FTS5 |
| File watching | `notify` | 8.2 | Industry standard (rust-analyzer, deno, cargo-watch). Custom debounce thread for reindex + rescan handling |
| Dir traversal | `walkdir` | 2.5 | Recursive directory walking for indexer reconciliation |
| Dir traversal (filtered) | `ignore` | 0.4 | From ripgrep — combines walkdir + .gitignore filtering. Used for content search |
| YAML | `serde_yaml_ng` | 0.10 | `serde_yaml` is deprecated, `serde_yml` has RustSec advisory. This is the maintained fork |
| Regex | `regex` | 1 | Wikilink + tag extraction from markdown content |
| Templates | `minijinja` | 2 | 10x faster compile than handlebars/tera. `{{ var }}` syntax for periodic note templates |
| Dates | `chrono` | 0.4 | `NaiveDate` for periodic note paths, ISO week handling |
| OS trash | `trash` | 5 | Cross-platform native trash (macOS, Windows, FreeDesktop) |
| Paths | `dirs-next` | 2.0 | XDG-compliant data directory resolution (`~/.onyx`) |
| macOS UI | `cocoa` + `objc` | 0.26 / 0.2.7 | NSSpellChecker for native spellcheck, App Nap prevention, window corner radius |
| Serialization | `serde` + `serde_json` | 1 | JSON serialization for IPC, config, frontmatter |
| Logging | `log` + `tauri-plugin-log` | 0.4 / 2 | Structured logging from Rust to WebView console |
| URL opener | `tauri-plugin-opener` | 2.5 | Opens http/https URLs in default browser. `opener:default` capability permission |
| Tauri | `tauri` | 2.10 | App framework, IPC, window management, event system |

### Not Yet Used (planned)

| Crate | Purpose | When |
|-------|---------|------|
| `notify-debouncer-full` | Rename coalescing + file ID tracking | If external rename detection proves unreliable (see FS_REACTIVITY_SPEC.md §3.7) |
| `rmcp` + `axum` | MCP server (streamable HTTP) | Phase 11+ |
| `nucleo-matcher` | Fuzzy search for quick open | Phase 11+ (currently using SQL LIKE) |
| `rayon` | Parallel indexing for large vaults | If reconciliation proves slow at scale |
| `pulldown-cmark` | Markdown AST parsing | If we need structural analysis beyond regex extraction |

### Concurrency Pattern

- **tokio** (provided by Tauri) — async I/O, IPC command handling
- **std::thread** — background indexer, watcher debounce processor, reconciliation
- **Mutex<T>** — shared state (DB, watcher, config). All DB access behind single Mutex
- **app.emit()** — Rust-to-frontend event emission for `fs:change` events

---

## Frontend (`package.json`)

| Category | Package | Why |
|----------|---------|-----|
| Editor | `@codemirror/*` (lang-markdown, lang-yaml, language-data, autocomplete, search, state, view) | Core CM6 markdown editing stack |
| Editor theme | `@codemirror/theme-one-dark` | Structural reference for custom dark theme |
| Editor wikilinks | `lezer-markdown-obsidian` (vendored in extensions) | Wikilink + tag + highlight parser nodes |
| Table editing | `@tgrosinger/md-advanced-tables` | Table formatting + column operations, adapted via tableAdapter.ts |
| UI framework | `react` + `react-dom` | 19.2 — UI rendering |
| State | `zustand` | 5.0 — minimal state management. Pane-aware store with memoized selectors |
| Tauri IPC | `@tauri-apps/api` + `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs` + `@tauri-apps/plugin-opener` | Tauri 2 frontend bindings. Opener used for opening external URLs in default browser |
| macOS styling | `@cloudworxx/tauri-plugin-mac-rounded-corners` | Window corner radius fix for Tauri on macOS |

### Built Custom (replaced planned dependencies)

These were in the original research but we built lightweight custom implementations instead:

| Planned | Lines | Why custom |
|---------|-------|------------|
| `@headless-tree/react` (file tree) | Sidebar.tsx ~591 | Custom tree with inline rename, context menu, directory colors — simpler than adapting headless tree |
| `@dnd-kit/sortable` (tab reorder) | TabBar.tsx ~103 | Native HTML5 drag works fine for tab reorder |
| `cmdk` (command palette) | CommandPalette.tsx ~123 | Custom palette with fuzzy search is trivial |
| `@radix-ui/react-context-menu` | SidebarContextMenu.tsx ~120 | Custom context menu avoids Radix dependency |
| `react-day-picker` (calendar) | Calendar.tsx ~273 | Custom calendar with week numbers + periodic note dots |
| `react-resizable-panels` (split panes) | Editor.tsx ~625 | Custom pane layout with draggable divider, max 3 panes |
| `react-hotkeys-hook` | keybindings.ts ~174 | Custom keybinding registry with conflict detection |
| `sonner` (toasts) | — | Not yet needed — errors go to console or status bar |
| `date-fns` | — | `chrono` handles dates in Rust; JS uses native Date |

---

## Reference Projects

Ranked by direct relevance to Onyx.

### Near-Identical Stack

| Project | Stack | Stars | Study For | URL |
|---------|-------|-------|-----------|-----|
| **Lumina Note** | Tauri v2 + React 18 + CM6 + Zustand + SQLite | 727 | CM6 live markdown, wikilinks, three editor modes | https://github.com/blueberrycongee/Lumina-Note |
| **Otterly** | Tauri + Svelte + SQLite FTS5 + ProseMirror | 108 | Hexagonal architecture, FTS5 search, wikilink tracking | https://github.com/ajkdrag/otterly |

### CM6 Editor References

| Project | Stars | Study For | URL |
|---------|-------|-----------|-----|
| **Zettlr** | 12.6k | Best CM6 editor setup, table editor | https://github.com/Zettlr/Zettlr |
| **MarkEdit** | 3.8k | Native app + CM6 webview hybrid | https://github.com/MarkEdit-app/MarkEdit |
| **codemirror-rich-markdoc** | ~100 | Live preview `Decoration.replace()` pattern | https://github.com/segphault/codemirror-rich-markdoc |

### Key Findings

1. **`serde_yaml` is dead** — must use `serde_yaml_ng`
2. **`lezer-markdown-obsidian`** gives CM6 wikilink + tag parsing — saved significant work
3. **Most planned frontend deps weren't needed** — custom implementations are simpler and smaller
4. **`notify` raw + custom debounce** works well enough; `notify-debouncer-full` deferred until needed

---

## Appendix: Pre-Build Research (historical)

Research conducted before implementation. Star counts from Feb/Mar 2026.

### Reference Projects — Full List

#### Near-Identical Stack

| Project | Stack | Stars | Study For | URL |
|---------|-------|-------|-----------|-----|
| **Lumina Note** | Tauri v2 + React 18 + CM6 + Zustand + SQLite | 727 | CM6 live markdown, wikilinks, three editor modes, database views | https://github.com/blueberrycongee/Lumina-Note |
| **Otterly** | Tauri + Svelte + SQLite FTS5 + ProseMirror | 108 | Hexagonal architecture, FTS5 search, wikilink + backlink tracking | https://github.com/ajkdrag/otterly |

#### CM6 Editor References

| Project | Stack | Stars | Study For | URL |
|---------|-------|-------|-----------|-----|
| **Zettlr** | Electron + CM6 + TypeScript + Vue 3 | 12.6k | Best CM6 editor setup — `editor-extension-sets.ts`, renderers, table editor | https://github.com/Zettlr/Zettlr |
| **MarkEdit** | Swift/macOS + CM6 in WKWebView | 3.8k | Native app + CM6 webview hybrid (similar to Tauri approach), handles 10MB files | https://github.com/MarkEdit-app/MarkEdit |
| **ink-mde** | TypeScript + CM6, framework-agnostic | 292 | Clean, minimal CM6 setup with GFM, hybrid preview, vim mode | https://github.com/davidmyersdev/ink-mde |
| **SilverBullet** | Deno + CM6 + Preact + Lua | 4.8k | CM6 + lightweight frontend, query language over markdown, indexing | https://github.com/silverbulletmd/silverbullet |
| **codemirror-rich-markdoc** | CM6 extension | ~100 | Live preview pattern — hiding markup via `Decoration.replace()` | https://github.com/segphault/codemirror-rich-markdoc |
| **lezer-markdown-obsidian** | Lezer parser extensions | 7 | Wikilink, tag, embed, highlight parser nodes for CM6 | https://github.com/erykwalder/lezer-markdown-obsidian |

#### Architecture Patterns

| Project | Stack | Stars | Study For | URL |
|---------|-------|-------|-----------|-----|
| **Otterly** | Tauri + Svelte + SQLite FTS5 + ProseMirror | 108 | Best Rust backend of all candidates | https://github.com/ajkdrag/otterly |
| **AppFlowy** | Flutter + Rust | 68.5k | Rust backend architecture, event-driven frontend-Rust communication | https://github.com/AppFlowy-IO/AppFlowy |
| **Anytype** | Electron + React + Go middleware | 7.2k | Typed objects system design (validates our `object-types.json` approach) | https://github.com/anyproto/anytype-ts |
| **HelixNotes** | Tauri 2 + SvelteKit + Tantivy | — | Full-text search via Tantivy, graph view, Obsidian import | https://codeberg.org/ArkHost/HelixNotes |

#### Otterly Deep Dive — Rust Patterns

Otterly's Rust backend was the best-structured of all candidates. Key files studied:

- **File I/O:** `features/notes/service.rs` — Atomic writes, conflict detection via mtime, path traversal protection
- **Watcher:** `features/watcher/service.rs` — Clean `notify` integration with event classification, graceful shutdown
- **Search:** `features/search/db.rs` — FTS5 with BM25 ranking, batch indexing, cancellation via AtomicBool
- **Links:** `features/search/link_parser.rs` — Wikilink + markdown link extraction, backlink graph queries

Architecture patterns we adopted: A1 (atomic writes), A2 (mtime conflict detection), A3 (path traversal protection). Deferred: A5 (separate reader/writer connections), A6 (worker thread per vault), A7 (folder cache with TTL).

#### Obsidian Plugin References

| Plugin | Stars | Studied For | URL |
|--------|-------|-------------|-----|
| **periodic-notes** | 1.3k | Date-to-filepath mapping, template application | https://github.com/liamcain/obsidian-periodic-notes |
| **dataview** | 8.6k | YAML frontmatter indexing, typed data model | https://github.com/blacksmithgu/obsidian-dataview |
| **outliner** | 1.3k | List manipulation, keyboard-driven indent/outdent | https://github.com/vslinko/obsidian-outliner |
| **calendar** | 2.1k | Calendar widget rendering | https://github.com/liamcain/obsidian-calendar-plugin |

#### Other Tauri Note Apps

| Project | Stack | Stars | URL |
|---------|-------|-------|-----|
| **NoteGen** | Tauri + Next.js + React | 11k | https://github.com/codexu/note-gen |
| **Rhyolite** | Tauri + Rust-heavy | 180 | https://github.com/lockedmutex/rhyolite |
| **Open Note** | Tauri + React + TipTap | — | https://github.com/JeremiasVillane/open-note |

#### Cautionary Tales

| Project | Stars | Lesson |
|---------|-------|--------|
| **Notable** | 23.6k | Proved demand for "markdown + YAML + tags". Went closed-source, community backlash |
| **MarkText** | 54.4k | Built custom editor engine (Muya) instead of using CM6 — maintenance burden killed the project |

### Original Cargo.toml Plan (pre-build)

```toml
rusqlite = { version = "0.38", features = ["bundled"] }
rusqlite_migration = "1"
notify = "8.2"
notify-debouncer-full = "0.5"
serde_yaml_ng = "0.10"
serde = { version = "1", features = ["derive"] }
pulldown-cmark = "0.12"
minijinja = "2"
rmcp = { version = "0.16", features = ["transport-streamable-http-server", "server"] }
axum = "0.8"
ignore = "0.4"
trash = "5.2"
nucleo-matcher = "0.3"
chrono = { version = "0.4", features = ["serde"] }
rayon = "1.10"
tokio = { version = "1", features = ["sync"] }
```
