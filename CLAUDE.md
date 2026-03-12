# Onyx — Context for AI Assistants

Lightweight, offline-first markdown note-taking app. Tauri 2 + React 18 + CodeMirror 6 + SQLite.

## Key Documents

- `ARCHITECTURE.md` — Full design spec (layout, data model, editor, theming, feature tiers)
- `DEVPLAN.md` — 10-phase implementation plan with step-by-step breakdowns
- `GUIDELINES.md` — Development rules (surface parity, code style, error handling)
- `DEPENDENCIES.md` — Crate/package rationale

## Current Status

- **Phase 1 (Skeleton):** Complete
- **Phase 2 (Core Editor):** Complete
- **Phase 3 (Links & Connections):** Complete
- **Phase 4 (Typed Objects & Properties):** Complete
- **Phase 4.5 (File Operations & Cache Integrity):** Complete
- **Phase 4.6 (Hardening):** Complete
- **Phase 5 (Periodic Notes & Calendar):** Upcoming
- **Phase 6 (Command Palette, Theming & Editor Polish):** Planned
- **Phase 7 (Live Preview & Split Panes):** Planned
- **Phase 8 (Blocks, Tables & Power Editing):** Planned
- **Phase 9 (MCP Server):** Planned
- **Phase 10 (Tier 2 Features):** Planned

## Project Structure

```
src/                          # Frontend (React + TypeScript)
├── main.tsx                  #   12 lines — React entry point
├── App.tsx                   #   79 lines — Root component, keyboard shortcuts, session restore
├── stores/
│   └── app.ts                #  150 lines — Zustand store (tabs, panels, cursor, fileTreeVersion)
├── components/
│   ├── Titlebar.tsx          #   25 lines — Custom titlebar with window controls
│   ├── TabBar.tsx            #   41 lines — Tab strip with close/modified indicator
│   ├── Sidebar.tsx           #  330 lines — File tree, inline rename, add/remove dir
│   ├── BookmarkStrip.tsx     #   80 lines — Bookmarks section pinned at sidebar bottom
│   ├── SidebarContextMenu.tsx#  130 lines — Right-click context menu for file tree
│   ├── ErrorBoundary.tsx     #   35 lines — React error boundary (wraps sidebar, editor, context panel)
│   ├── Editor.tsx            #  456 lines — CM6 editor with state caching, cache migration exports
│   ├── ContextPanel.tsx      #  493 lines — Backlinks, property editor (typed + untyped)
│   ├── StatusBar.tsx         #   27 lines — Cursor position, word count
│   └── QuickOpen.tsx         #  256 lines — Cmd+O fuzzy search + type: prefix queries
├── extensions/
│   ├── frontmatter.ts        #  136 lines — CM6: frontmatter detection, styling, auto-fold
│   ├── wikilinks.ts          #  136 lines — CM6: wikilink syntax highlighting, Cmd+Enter follow
│   └── tags.ts               #   98 lines — CM6: #tag syntax highlighting
├── lib/
│   ├── fileOps.ts            #  118 lines — Centralized file mutations (create/rename/delete)
│   ├── openFile.ts           #   20 lines — Shared open-file-in-editor utility
│   └── session.ts            #   85 lines — Tab/panel state persistence (~/.onyx/session.json via Rust)
└── styles/
    ├── reset.css             #   56 lines — CSS reset
    ├── theme.css             #   63 lines — CSS custom properties (dark theme)
    └── layout.css            #  779 lines — All component styles

src-tauri/                    # Backend (Rust)
├── Cargo.toml                # Dependencies
├── tauri.conf.json           # Window config, dev URL, CSP
└── src/
    ├── main.rs               #    6 lines — Entry point
    ├── lib.rs                #  109 lines — Tauri setup, AppState, plugin registration
    ├── commands.rs           #  493 lines — Tauri commands (file ops, search, bookmarks, types)
    ├── db.rs                 #  490 lines — SQLite (WAL, files/links/tags/bookmarks/object_types)
    ├── dirs.rs               #  117 lines — Directory registration (~/.onyx/directories.json)
    ├── indexer.rs            #  224 lines — Background indexer (frontmatter, wikilinks, tags)
    ├── watcher.rs            #  173 lines — File watcher with debounced reindex
    └── object_types.rs       #  135 lines — Type registry (~/.onyx/object-types.json)
```

**Total:** ~5,700 lines (2,850 TS/TSX + 1,800 Rust + 930 CSS)

## Architecture Essentials

- **State split:** Zustand owns UI state (tabs, panels). CM6 owns editor state (content, undo, cursor). Rust owns file data + index.
- **Editor pattern:** Single persistent `EditorView`, state swapped via `setState()` on tab switch. `EditorState` cached per tab (preserves undo/cursor/scroll). Module-level `activeTabIdBox` object for cross-closure communication.
- **File mutations:** All through `src/lib/fileOps.ts` which owns the full sequence: disk → DB → tabs → editor caches → tree refresh. Components never call `invoke("rename_file")` etc. directly.
- **File I/O:** All through Rust commands. Atomic writes (temp + rename). Auto-save 500ms debounce.
- **Indexing:** Background thread walks directories, extracts frontmatter/wikilinks/tags, stores in SQLite. File watcher triggers 3s debounced reindex.
- **No Tailwind.** Plain CSS with custom properties.
- **Type-only imports:** CM6 types like `Extension`, `DecorationSet` must use `import type` or `type` keyword — they don't exist at runtime.

## Commands (Rust → Frontend)

### File Operations
| Command | Signature |
|---------|-----------|
| `list_directory` | `(path: String) → Vec<DirEntry>` |
| `read_file` | `(path: String) → String` |
| `write_file` | `(path: String, content: String) → ()` |
| `path_exists` | `(path: String) → bool` |
| `create_folder` | `(path: String) → ()` |
| `rename_file` | `(oldPath: String, newPath: String) → ()` — handles files and folders |
| `trash_file` | `(path: String) → ()` — OS trash, handles files and folders |
| `reveal_in_finder` | `(path: String) → ()` — cross-platform |

### Directory Management
| Command | Signature |
|---------|-----------|
| `get_registered_directories` | `() → Vec<RegisteredDirectory>` |
| `register_directory` | `(path, label, color) → RegisteredDirectory` |
| `unregister_directory` | `(id: String) → ()` |

### Search & Index
| Command | Signature |
|---------|-----------|
| `search_files` | `(query: String) → Vec<SearchResult>` |
| `get_backlinks` | `(path: String) → Vec<BacklinkRecord>` |
| `get_index_stats` | `() → IndexStats` |
| `resolve_wikilink` | `(link: String, contextPath: String) → Option<String>` |

### Bookmarks
| Command | Signature |
|---------|-----------|
| `toggle_bookmark` | `(path: String) → bool` |
| `get_bookmarks` | `() → Vec<BookmarkRecord>` |
| `is_file_bookmarked` | `(path: String) → bool` |

### Typed Objects & Frontmatter
| Command | Signature |
|---------|-----------|
| `get_object_types` | `() → Vec<ObjectType>` |
| `query_by_type` | `(typeName: String) → Vec<SearchResult>` |
| `get_file_frontmatter` | `(path: String) → Option<String>` (JSON) |
| `update_frontmatter` | `(path: String, frontmatterJson: String) → ()` |

### Session
| Command | Signature |
|---------|-----------|
| `read_session` | `() → Option<String>` (JSON) |
| `write_session` | `(json: String) → ()` |

## Build & Run

```bash
cargo tauri dev          # Dev server (Vite HMR + Rust hot reload)
cargo check              # Rust type check (use instead of full build to save RAM)
cargo test               # Rust unit tests
npx tsc --noEmit         # TypeScript type check
```

## Gotchas

- `getCurrentWindow()` must be called lazily (in handlers), not at module/component level
- `sharedExtensions` initialized once on first Editor mount — `loadFileIntoCache` before mount creates bare states (auto-detected and rebuilt)
- File watcher has `Drop` impl that signals shutdown and joins the debounce thread
- `unchecked_transaction` in db.rs is safe because all DB access is behind a Mutex
- File mutations must go through `fileOps.ts`, never direct `invoke()` — otherwise editor caches, tabs, and sidebar fall out of sync
- `replaceTabContent()` must be called after external writes (e.g. property panel) to sync CM6 state
