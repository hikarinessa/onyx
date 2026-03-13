# Onyx — Context for AI Assistants

Lightweight, offline-first markdown note-taking app. Tauri 2 + React 18 + CodeMirror 6 + SQLite.

## Key Documents

- `ARCHITECTURE.md` — Full design spec (layout, data model, editor, theming, feature tiers)
- `DEVPLAN.md` — 12-phase implementation plan with step-by-step breakdowns
- `GUIDELINES.md` — Development rules (surface parity, code style, error handling)
- `DEPENDENCIES.md` — Crate/package rationale

## Current Status

- **Phase 1–6:** Complete (skeleton → core editor → links → typed objects → file ops → hardening → periodic notes → backfill → command palette & theming)
- **Phase 7 (Live Preview & Navigation):** Complete
- **Phase 7.5 (Hardening & CSS Architecture):** Planned
- **Phase 8 (Split Panes):** Planned
- **Phase 9 (Tables):** Planned
- **Phase 10 (Per-Block Features):** Planned
- **Phase 11 (MCP Server):** Planned
- **Phase 12 (Tier 2 Features):** Planned

**Current version:** 0.7.0

## Project Structure

```
src/                          # Frontend (React + TypeScript)
├── main.tsx                  #   12 lines — React entry point
├── App.tsx                   #  324 lines — Root component, shortcuts, command registration, menu events
├── stores/
│   └── app.ts                #  309 lines — Zustand store (tabs, panes, nav stack, panels, commands)
├── components/
│   ├── Titlebar.tsx          #    8 lines — Custom titlebar with traffic lights spacer
│   ├── TabBar.tsx            #   84 lines — Tab strip with drag-to-reorder
│   ├── Sidebar.tsx           #  458 lines — File tree, collapsible dirs, inline rename
│   ├── BookmarkStrip.tsx     #  106 lines — Bookmarks section pinned at sidebar bottom
│   ├── SidebarContextMenu.tsx#  120 lines — Right-click context menu for file tree
│   ├── ErrorBoundary.tsx     #   50 lines — React error boundary
│   ├── Editor.tsx            #  564 lines — CM6 editor, inline title, live preview sync
│   ├── ContextPanel.tsx      #  629 lines — Calendar, backlinks, properties, outline, recent docs
│   ├── Calendar.tsx          #  261 lines — Month-grid calendar with week numbers
│   ├── StatusBar.tsx         #   59 lines — Cursor, word count, lint status, editor mode, file path
│   ├── QuickOpen.tsx         #  264 lines — Cmd+O fuzzy search + type: prefix queries
│   └── CommandPalette.tsx    #  123 lines — Cmd+P fuzzy command search
├── extensions/
│   ├── frontmatter.ts        #  153 lines — CM6: frontmatter detection, styling, auto-fold, fold command
│   ├── wikilinks.ts          #  157 lines — CM6: wikilink syntax highlighting, click to follow
│   ├── tags.ts               #  109 lines — CM6: #tag syntax highlighting (viewport-aware)
│   ├── formatting.ts         #  118 lines — CM6: Cmd+B/I/Shift+C toggle wrap (multi-cursor safe)
│   ├── outliner.ts           #  160 lines — CM6: list item indent/outdent/move/enter
│   ├── urlPaste.ts           #   30 lines — CM6: URL paste → markdown link
│   ├── autocomplete.ts       #   96 lines — CM6: wikilink + tag autocomplete
│   ├── livePreview.ts        #  387 lines — CM6: live preview (headings, bold/italic, checkboxes, wikilinks, strikethrough, highlight)
│   ├── symbolWrap.ts         #   61 lines — CM6: wrap selection with brackets/quotes/markdown on type
│   └── linting.ts            #  (planned) — CM6: markdown lint rules + autofix on save
├── lib/
│   ├── fileOps.ts            #  155 lines — Centralized file mutations (with link warnings)
│   ├── openFile.ts           #   63 lines — Shared open-file-in-editor utility (with nav stack)
│   ├── periodicNotes.ts      #   31 lines — Create/open periodic notes utility
│   ├── recentDocs.ts         #   50 lines — Recent documents tracking (localStorage ring buffer)
│   ├── session.ts            #  176 lines — Tab/panel/pane state persistence (~/.onyx/session.json)
│   ├── commands.ts           #   33 lines — Command registry for palette + menu bar
│   └── themes.ts             #  138 lines — Theme system (dark/light/warm)
└── styles/
    ├── reset.css             #   56 lines — CSS reset
    ├── theme.css             #   63 lines — CSS custom properties (dark theme)
    └── layout.css            # 1210 lines — All component styles

src-tauri/                    # Backend (Rust)
├── Cargo.toml                # Dependencies
├── tauri.conf.json           # Window config, dev URL, CSP
└── src/
    ├── main.rs               #    6 lines — Entry point
    ├── lib.rs                #  209 lines — Tauri setup, native menu bar, AppState, plugins
    ├── commands.rs           #  892 lines — Tauri commands (file ops, search, bookmarks, autocomplete)
    ├── db.rs                 #  555 lines — SQLite (WAL, files/links/tags/bookmarks + tag/title queries)
    ├── dirs.rs               #  117 lines — Directory registration (~/.onyx/directories.json)
    ├── indexer.rs            #  235 lines — Background indexer (frontmatter, wikilinks, tags)
    ├── watcher.rs            #  195 lines — File watcher with debounced reindex
    ├── object_types.rs       #  135 lines — Type registry (~/.onyx/object-types.json)
    ├── periodic.rs           #  451 lines — Periodic notes config, template engine, date formatting
    └── plugins/
        └── mac_rounded_corners.rs # 217 lines — macOS window corner radius fix
```

**Total:** ~9,400 lines (5,200 TS/TSX + 3,000 Rust + 1,300 CSS)

## Architecture Essentials

- **State split:** Zustand owns UI state (tabs, panels, nav stacks). CM6 owns editor state (content, undo, cursor). Rust owns file data + index.
- **Editor pattern:** Single persistent `EditorView`, state swapped via `setState()` on tab switch. `EditorState` cached per tab (preserves undo/cursor/scroll). Module-level `activeTabIdBox` object for cross-closure communication.
- **Inline title:** Editable `<input>` above the editor showing the filename (without `.md`). Renaming commits on blur/Enter via `fileOps.renameFile`. Strips file-unsafe characters (`/`, `\0`, `:`).
- **Live preview:** CM6 `ViewPlugin` + `StateField<boolean>`. Viewport-aware decorations. "Focus line" shows raw markdown; all other lines render inline. Elements: headings, bold/italic/bold-italic, strikethrough, highlight, checkboxes (interactive), wikilinks (clickable).
- **Editor modes:** "preview" (default) renders markdown inline. "source" shows raw markdown. Per-tab, persisted in session. Toggled via `Cmd+/`.
- **Navigation:** Per-tab back/forward stack (50-entry cap). Click replaces current tab; Cmd+click opens new tab. Mouse buttons 3/4 navigate history.
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
| `create_periodic_note` | `(periodType: String, date: String) → CreatePeriodicNoteResult` — date accepts YYYY-MM-DD or YYYY-Www |
| `get_dates_with_notes` | `(year: i32, month: u32) → Vec<u32>` — day numbers with notes |
| `get_weeks_with_notes` | `(weeks: Vec<String>) → Vec<String>` — which ISO weeks (YYYY-Www) have notes |

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

## Known Debt

- **Focus trapping:** Command palette and QuickOpen overlays don't trap Tab focus. Keyboard-only users can Tab behind the overlay.
- **Tab reorder accessibility:** Drag-to-reorder is mouse-only. Add Cmd+Shift+Left/Right for keyboard users.
- **ARIA on command palette:** Category headers need `role="separator"` or group wrapping for screen readers.
- **Autocomplete scaling:** `get_all_titles` fetches all indexed files on `[[` with empty prefix. Cache with short TTL for vaults >5k files.
- **Multi-cursor formatting:** `toggleWrap` in `formatting.ts` offset drift fixed, but needs multi-cursor integration test.
- **Duplicate preview sync:** Editor.tsx syncs `previewModeField` in both the tab-switch effect and a separate `useEffect(editorMode)`. Consider consolidating to a single sync point.
- **Code-block pre-scan scaling:** `tags.ts` and `livePreview.ts` scan from line 1 to the first visible line on every viewport change. O(n) from top of doc. Could cache per doc version. Not a problem under ~50K lines.
- **Heading line decorations not hoisted:** `Decoration.line()` in `buildPreviewDecorations` uses a dynamic class per heading level (h1-h6). Could pre-build 6 constants.
- **Split panes not yet implemented:** ARCHITECTURE.md specifies split panes (7.4) but Phase 7 shipped without them. Nav stack, inline title, and live preview were prioritized. Split panes are next.

## Gotchas

- **Kill `cargo tauri dev` before making Rust changes.** The dev server watches Rust files and auto-rebuilds + relaunches the app on every save, causing repeated open/close cycles during multi-file edits. Stop the dev process first, make all backend changes, verify with `cargo check`, then relaunch once when ready to test.
- **`sharedExtensions` is cached at module level.** Built once on first Editor mount. HMR cannot rebuild them — changes to extension code (keymaps, decorations) require full app restart (`kill cargo tauri dev` + relaunch).
- `getCurrentWindow()` must be called lazily (in handlers), not at module/component level
- File watcher has `Drop` impl that signals shutdown and joins the debounce thread
- `unchecked_transaction` in db.rs is safe because all DB access is behind a Mutex
- File mutations must go through `fileOps.ts`, never direct `invoke()` — otherwise editor caches, tabs, and sidebar fall out of sync
- `replaceTabContent()` must be called after external writes (e.g. property panel) to sync CM6 state
- **WKWebView keyboard limitations:** Tauri uses WebKit, not Chromium. Some keyboard shortcuts (e.g. `Cmd+Shift+Arrow`) are consumed by the Cocoa text system before reaching JavaScript. Use the `mac` property on CM6 keybindings for platform-specific alternatives.
