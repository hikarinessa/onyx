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
- **Phase 5 (Periodic Notes & Calendar):** Complete
- **Phase 5.X (Backfill):** Complete
- **Phase 6 (Command Palette, Theming & Editor Polish):** Complete
- **Phase 7 (Live Preview & Split Panes):** Planned
- **Phase 8 (Blocks, Tables & Power Editing):** Planned
- **Phase 9 (MCP Server):** Planned
- **Phase 10 (Tier 2 Features):** Planned

## Project Structure

```
src/                          # Frontend (React + TypeScript)
├── main.tsx                  #   12 lines — React entry point
├── App.tsx                   #  210 lines — Root component, shortcuts, command registration, menu events
├── stores/
│   └── app.ts                #  200 lines — Zustand store (tabs, panels, cursor, themes, commands)
├── components/
│   ├── Titlebar.tsx          #   25 lines — Custom titlebar with traffic lights spacer
│   ├── TabBar.tsx            #   80 lines — Tab strip with drag-to-reorder
│   ├── Sidebar.tsx           #  460 lines — File tree, collapsible dirs, inline rename
│   ├── BookmarkStrip.tsx     #   80 lines — Bookmarks section pinned at sidebar bottom
│   ├── SidebarContextMenu.tsx#  130 lines — Right-click context menu for file tree
│   ├── ErrorBoundary.tsx     #   35 lines — React error boundary
│   ├── Editor.tsx            #  460 lines — CM6 editor with all extensions
│   ├── ContextPanel.tsx      #  590 lines — Calendar, backlinks, properties, recent docs
│   ├── Calendar.tsx          #  130 lines — Month-grid calendar widget
│   ├── StatusBar.tsx         #   40 lines — Cursor, word count, char count, file path
│   ├── QuickOpen.tsx         #  256 lines — Cmd+O fuzzy search + type: prefix queries
│   └── CommandPalette.tsx    #  120 lines — Cmd+P fuzzy command search
├── extensions/
│   ├── frontmatter.ts        #  136 lines — CM6: frontmatter detection, styling, auto-fold
│   ├── wikilinks.ts          #  136 lines — CM6: wikilink syntax highlighting, Cmd+Enter follow
│   ├── tags.ts               #   98 lines — CM6: #tag syntax highlighting
│   ├── formatting.ts         #   70 lines — CM6: Cmd+B/I/Shift+C toggle wrap
│   ├── outliner.ts           #  130 lines — CM6: list item indent/outdent/move/enter
│   ├── urlPaste.ts           #   30 lines — CM6: URL paste → markdown link
│   └── autocomplete.ts       #   95 lines — CM6: wikilink + tag autocomplete
├── lib/
│   ├── fileOps.ts            #  130 lines — Centralized file mutations (with link warnings)
│   ├── openFile.ts           #   22 lines — Shared open-file-in-editor utility
│   ├── periodicNotes.ts      #   32 lines — Create/open periodic notes utility
│   ├── recentDocs.ts         #   50 lines — Recent documents tracking (localStorage ring buffer)
│   ├── session.ts            #   85 lines — Tab/panel state persistence (~/.onyx/session.json via Rust)
│   ├── commands.ts           #   45 lines — Command registry for palette + menu bar
│   └── themes.ts             #  120 lines — Theme system (dark/light/warm)
└── styles/
    ├── reset.css             #   56 lines — CSS reset
    ├── theme.css             #   63 lines — CSS custom properties (dark theme)
    └── layout.css            #  779 lines — All component styles

src-tauri/                    # Backend (Rust)
├── Cargo.toml                # Dependencies
├── tauri.conf.json           # Window config, dev URL, CSP
└── src/
    ├── main.rs               #    6 lines — Entry point
    ├── lib.rs                #  185 lines — Tauri setup, native menu bar (app+file+edit+view+go+format+window+help), AppState, plugins
    ├── commands.rs           #  540 lines — Tauri commands (file ops, search, bookmarks, autocomplete)
    ├── db.rs                 #  550 lines — SQLite (WAL, files/links/tags/bookmarks + tag/title queries)
    ├── dirs.rs               #  117 lines — Directory registration (~/.onyx/directories.json)
    ├── indexer.rs            #  224 lines — Background indexer (frontmatter, wikilinks, tags)
    ├── watcher.rs            #  173 lines — File watcher with debounced reindex
    ├── object_types.rs       #  135 lines — Type registry (~/.onyx/object-types.json)
    └── periodic.rs           #  320 lines — Periodic notes config, template engine, date formatting
```

**Total:** ~7,200 lines (3,700 TS/TSX + 2,100 Rust + 1,100 CSS)

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

### Bookmarks (Directory)
| Command | Signature |
|---------|-----------|
| `toggle_bookmark` | `(path: String) → bool` — requires file in registered dir |
| `get_bookmarks` | `() → Vec<BookmarkRecord>` |
| `is_file_bookmarked` | `(path: String) → bool` |

### Global Bookmarks
| Command | Signature |
|---------|-----------|
| `toggle_global_bookmark` | `(path: String, label: String) → bool` — any file on disk |
| `get_global_bookmarks` | `() → Vec<GlobalBookmark>` |
| `is_global_bookmarked` | `(path: String) → bool` |

### Typed Objects & Frontmatter
| Command | Signature |
|---------|-----------|
| `get_object_types` | `() → Vec<ObjectType>` |
| `query_by_type` | `(typeName: String) → Vec<SearchResult>` |
| `get_file_frontmatter` | `(path: String) → Option<String>` (JSON) |
| `update_frontmatter` | `(path: String, frontmatterJson: String) → ()` |

### Periodic Notes
| Command | Signature |
|---------|-----------|
| `get_periodic_config` | `() → PeriodicConfig` |
| `save_periodic_config` | `(config: PeriodicConfig) → ()` |
| `create_periodic_note` | `(periodType: String, date: String) → CreatePeriodicNoteResult` |
| `get_dates_with_notes` | `(year: i32, month: u32) → Vec<u32>` — day numbers with notes |

### Autocomplete & Metadata
| Command | Signature |
|---------|-----------|
| `get_all_tags` | `() → Vec<TagInfo>` — all tags with usage counts |
| `get_all_titles` | `() → Vec<SearchResult>` — all file titles for autocomplete |
| `count_incoming_links` | `(path: String) → u32` — count notes linking to this file |

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

## Known Debt (from Phase 5.X + 6 + 7 review)

- **Editor↔QuickOpen coupling:** `QuickOpen` imports `insertAtCursor` from `Editor.tsx`. Extract into `lib/editorBridge.ts` when adding more consumers.
- **Focus trapping:** Command palette and QuickOpen overlays don't trap Tab focus. Keyboard-only users can Tab behind the overlay.
- **Tab reorder accessibility:** Drag-to-reorder is mouse-only. Add Cmd+Shift+Left/Right for keyboard users.
- **ARIA on command palette:** Category headers need `role="separator"` or group wrapping for screen readers.
- **Autocomplete scaling:** `get_all_titles` fetches all indexed files on `[[` with empty prefix. Cache with short TTL for vaults >5k files.
- **Multi-cursor formatting:** `toggleWrap` in `formatting.ts` offset drift fixed, but needs multi-cursor integration test.
- **Editor.tsx size:** 640+ lines — owns two EditorView lifecycles, split pane rendering, save hooks, and 7 public API functions. Extract `EditorBridge` service to decouple consumers from component internals.
- **Circular dependency:** `ContextPanel → Editor → openFile → Editor`. Works but fragile. Extract shared exports into `editorShared.ts` or `lib/editorBridge.ts`.
- **Live preview pre-scan perf:** `buildPreviewDecorations` pre-scans from line 1 to first visible line on every cursor move. Cache code-block state at viewport start, invalidate only on `docChanged` for large docs (10k+ lines).
- **Word count on every keystroke:** `content.trim().split(/\s+/).length` allocates on each char typed. Debounce or compute less frequently for large files.
- **Double-char symbol wrap:** `[[`/`**`/`==` wrapping relies on char-before-selection detection that may not trigger as expected. Needs manual testing/verification.
- **Divider drag event churn:** `handleDividerMouseDown` recreates listeners on each ratio change during drag. Use a ref for `splitRatio`.
- **Outline items not keyboard accessible:** Plain `<div>` with `onClick`, needs `<button>` or `role="button" tabindex="0"`.
- **Split pane divider not keyboard accessible:** Missing `role="separator"` and arrow key handlers per WAI-ARIA separator pattern.
- **Rapid nav race condition:** Back/forward pop is synchronous but tab switch is async. Rapid Cmd+[ could double-pop. Guard with navigating flag if needed.

## Gotchas

- **Kill `cargo tauri dev` before making Rust changes.** The dev server watches Rust files and auto-rebuilds + relaunches the app on every save, causing repeated open/close cycles during multi-file edits. Stop the dev process first, make all backend changes, verify with `cargo check`, then relaunch once when ready to test.
- `getCurrentWindow()` must be called lazily (in handlers), not at module/component level
- `sharedExtensions` initialized once on first Editor mount — `loadFileIntoCache` before mount creates bare states (auto-detected and rebuilt)
- File watcher has `Drop` impl that signals shutdown and joins the debounce thread
- `unchecked_transaction` in db.rs is safe because all DB access is behind a Mutex
- File mutations must go through `fileOps.ts`, never direct `invoke()` — otherwise editor caches, tabs, and sidebar fall out of sync
- `replaceTabContent()` must be called after external writes (e.g. property panel) to sync CM6 state
