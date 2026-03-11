# Onyx — Context for AI Assistants

Lightweight, offline-first markdown note-taking app. Tauri 2 + React 18 + CodeMirror 6 + SQLite.

## Key Documents

- `ARCHITECTURE.md` — Full design spec (layout, data model, editor, theming, feature tiers)
- `DEVPLAN.md` — 9-phase implementation plan with step-by-step breakdowns
- `GUIDELINES.md` — Development rules (surface parity, code style, error handling)
- `DEPENDENCIES.md` — Crate/package rationale

## Current Status

- **Phase 1 (Skeleton):** Complete
- **Phase 2 (Core Editor):** Complete
- **Phase 3 (Links & Connections):** Complete
- **Phase 4 (Typed Objects & Properties):** Next

## Project Structure

```
src/                          # Frontend (React + TypeScript)
├── main.tsx                  #   12 lines — React entry point
├── App.tsx                   #   79 lines — Root component, keyboard shortcuts, session restore
├── stores/
│   └── app.ts                #  107 lines — Zustand store (tabs, panels, cursor, hooks)
├── components/
│   ├── Titlebar.tsx          #   25 lines — Custom titlebar with window controls
│   ├── TabBar.tsx            #   41 lines — Tab strip with close/modified indicator
│   ├── Sidebar.tsx           #  466 lines — File tree, context menu, add folder, new note
│   ├── Editor.tsx            #  352 lines — CM6 editor with state caching per tab
│   ├── ContextPanel.tsx      #   16 lines — Placeholder (backlinks/properties go here)
│   ├── StatusBar.tsx         #   27 lines — Cursor position, word count
│   └── QuickOpen.tsx         #  165 lines — Cmd+O fuzzy search modal
├── extensions/
│   └── frontmatter.ts       #  136 lines — CM6: frontmatter detection, styling, auto-fold
├── lib/
│   ├── openFile.ts           #   20 lines — Shared open-file-in-editor utility
│   └── session.ts            #   90 lines — Tab/panel state persistence (localStorage)
└── styles/
    ├── reset.css             #   56 lines — CSS reset
    ├── theme.css             #   63 lines — CSS custom properties (dark theme)
    └── layout.css            #  476 lines — All component styles

src-tauri/                    # Backend (Rust)
├── Cargo.toml                # Dependencies
├── tauri.conf.json           # Window config, dev URL, CSP
└── src/
    ├── main.rs               #    6 lines — Entry point
    ├── lib.rs                #   95 lines — Tauri setup, AppState, plugin registration
    ├── commands.rs           #  207 lines — Tauri commands (list_dir, read/write, search, backlinks)
    ├── db.rs                 #  294 lines — SQLite (WAL, files/links/tags/bookmarks schema)
    ├── dirs.rs               #  117 lines — Directory registration (~/.onyx/directories.json)
    ├── indexer.rs            #  224 lines — Background indexer (frontmatter, wikilinks, tags)
    └── watcher.rs            #  173 lines — File watcher with debounced reindex
```

**Total:** ~2,700 lines (1,400 TS/TSX + 1,100 Rust + 600 CSS)

## Architecture Essentials

- **State split:** Zustand owns UI state (tabs, panels). CM6 owns editor state (content, undo, cursor). Rust owns file data + index.
- **Editor pattern:** Single persistent `EditorView`, state swapped via `setState()` on tab switch. `EditorState` cached per tab (preserves undo/cursor/scroll). Module-level `activeTabIdBox` object for cross-closure communication.
- **File I/O:** All through Rust commands. Atomic writes (temp + rename). Auto-save 500ms debounce.
- **Indexing:** Background thread walks directories, extracts frontmatter/wikilinks/tags, stores in SQLite. File watcher triggers 3s debounced reindex.
- **No Tailwind.** Plain CSS with custom properties.
- **Type-only imports:** CM6 types like `Extension`, `DecorationSet` must use `import type` or `type` keyword — they don't exist at runtime.

## Commands (Rust → Frontend)

| Command | Signature |
|---------|-----------|
| `list_directory` | `(path: String) → Vec<DirEntry>` |
| `read_file` | `(path: String) → String` |
| `write_file` | `(path: String, content: String) → ()` |
| `get_registered_directories` | `() → Vec<RegisteredDirectory>` |
| `register_directory` | `(path, label, color) → RegisteredDirectory` |
| `unregister_directory` | `(id: String) → ()` |
| `search_files` | `(query: String) → Vec<SearchResult>` |
| `get_backlinks` | `(path: String) → Vec<BacklinkRecord>` |
| `get_index_stats` | `() → IndexStats` |

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
- File watcher debounce thread has no shutdown signal (known debt item #8)
- `unchecked_transaction` in db.rs is safe because all DB access is behind a Mutex
