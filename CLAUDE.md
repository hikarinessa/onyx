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
- **Phase 7.5 (Hardening & CSS Architecture):** Complete
- **Phase 7.6 (Settings Window):** Complete
- **Phase 7.7 (Lucide Icons):** Complete
- **Phase 8 (Split Panes):** Planned
- **Phase 9 (Tables):** Planned
- **Phase 10 (Per-Block Features):** Planned
- **Phase 11 (MCP Server):** Planned
- **Phase 12 (Tier 2 Features):** Planned

**Current version:** 0.7.7

## Project Structure

```
src/                          # Frontend (React + TypeScript)
├── main.tsx                  #   12 lines — React entry point
├── App.tsx                   #  376 lines — Root component, keybinding dispatch, command registration, menu events
├── stores/
│   └── app.ts                #  378 lines — Zustand store (tabs, panes, nav stack, panels, settings, memoized selectors)
├── components/
│   ├── Titlebar.tsx          #    8 lines — Custom titlebar with traffic lights spacer
│   ├── TabBar.tsx            #   84 lines — Tab strip with drag-to-reorder
│   ├── Sidebar.tsx           #  499 lines — File tree, collapsible dirs, inline rename, orphan notes
│   ├── BookmarkStrip.tsx     #  106 lines — Bookmarks section pinned at sidebar bottom
│   ├── SidebarContextMenu.tsx#  120 lines — Right-click context menu for file tree
│   ├── ErrorBoundary.tsx     #   50 lines — React error boundary
│   ├── Editor.tsx            #  564 lines — CM6 editor, inline title, live preview sync
│   ├── ContextPanel.tsx      #  637 lines — Calendar, backlinks, properties, outline, recent docs
│   ├── Calendar.tsx          #  261 lines — Month-grid calendar with week numbers
│   ├── StatusBar.tsx         #   59 lines — Cursor, word count, lint status, editor mode, file path
│   ├── QuickOpen.tsx         #  264 lines — Cmd+O fuzzy search + type: prefix queries
│   ├── CommandPalette.tsx    #  123 lines — Cmd+P fuzzy command search
│   ├── Settings.tsx          #  704 lines — Settings modal (config, keybindings, themes, about)
│   ├── Icon.tsx              #   18 lines — Lucide icon wrapper: <Icon name="folder" size={16} />
│   └── IconPicker.tsx        #  100 lines — Modal icon picker with search + categories
├── extensions/
│   ├── frontmatter.ts        #  178 lines — CM6: frontmatter detection, styling, auto-fold, toggle-fold command
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
│   ├── openFile.ts           #   79 lines — Shared open-file-in-editor utility (with nav stack, orphan detection)
│   ├── periodicNotes.ts      #   31 lines — Create/open periodic notes utility
│   ├── recentDocs.ts         #   50 lines — Recent documents tracking (localStorage ring buffer)
│   ├── session.ts            #  185 lines — Tab/panel/pane state persistence (~/.onyx/session.json)
│   ├── ipcCache.ts           #   40 lines — TTL-based IPC query cache (reduces redundant Rust calls)
│   ├── commands.ts           #   33 lines — Command registry for palette + menu bar
│   ├── keybindings.ts        #  174 lines — Keybinding registry (parse, normalise, conflict detect, global keymap)
│   ├── themes.ts             #   59 lines — Theme system (data-theme attribute switching)
│   ├── configBridge.ts       #  257 lines — Config bridge: loads Rust config → CSS custom properties, remeasure hook
│   └── iconCatalog.ts       #  290 lines — Curated ~250 Lucide icons + category metadata
└── styles/
    ├── reset.css             #   67 lines — CSS reset (@layer reset, prefers-reduced-motion)
    ├── theme.css             #  117 lines — CSS layer order + custom properties (dark/light/warm via data-theme)
    └── layout.css            # 1726 lines — Layout/component styles (@layer layout, components) + unlayered editor overrides

src-tauri/                    # Backend (Rust)
├── Cargo.toml                # Dependencies
├── tauri.conf.json           # Window config, dev URL, CSP
└── src/
    ├── main.rs               #    6 lines — Entry point
    ├── lib.rs                #  254 lines — Tauri setup, native menu bar, AppState, App Nap prevention, plugins
    ├── commands.rs           # 1004 lines — Tauri commands (file ops, search, bookmarks, autocomplete, config, keybindings)
    ├── config.rs             #  233 lines — App config + keybinding persistence (~/.onyx/config.json, keybindings.json)
    ├── db.rs                 #  555 lines — SQLite (WAL, files/links/tags/bookmarks + tag/title queries)
    ├── dirs.rs               #  117 lines — Directory registration (~/.onyx/directories.json)
    ├── indexer.rs            #  235 lines — Background indexer (frontmatter, wikilinks, tags)
    ├── watcher.rs            #  195 lines — File watcher with debounced reindex
    ├── object_types.rs       #  135 lines — Type registry (~/.onyx/object-types.json)
    ├── periodic.rs           #  451 lines — Periodic notes config, template engine, date formatting
    └── plugins/
        └── mac_rounded_corners.rs # 217 lines — macOS window corner radius fix
```

**Total:** ~11,600 lines (6,400 TS/TSX + 3,300 Rust + 1,700 CSS)

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
- **CSS layers:** `@layer reset, tokens, base, layout, components` for specificity control. Editor styles are **unlayered** (must compete with CM6's unlayered runtime styles). Theming via `data-theme` attribute on `:root`.
- **Mtime conflict detection:** `write_file` records mtime on read, checks before write. Rejects saves if file was modified externally.
- **IPC cache:** `src/lib/ipcCache.ts` — TTL-based cache for expensive Rust queries (backlinks, etc.). Invalidated on `fs:change` events.
- **Memoized selectors:** `selectActiveTab`, `selectActiveTabPath`, etc. in `app.ts` — avoids `Array.find` on every store update (cursor moves, word counts).
- **App Nap prevention:** macOS `NSProcessInfo.beginActivityWithOptions` in `lib.rs` prevents throttling of auto-save timers.
- **Config system:** `~/.onyx/config.json` with `Config` struct (editor, appearance, behavior sections). Deep-merge updates via `serde_json::Value`. Loaded at startup into `AppState.config`.
- **Keybinding registry:** `src/lib/keybindings.ts` — centralized Map of command ID → binding. `parseKeyCombo(KeyboardEvent)` produces canonical strings (`Cmd+Shift+D`). Global shortcuts dispatched via keyMap lookup in App.tsx instead of hardcoded if-chains. Supports user overrides saved to `~/.onyx/keybindings.json`.
- **Settings modal:** `Settings.tsx` — 5-section modal (General, Editor, Appearance, Keybindings, About). Loads config from Rust on mount, saves partial patches via `update_config`. Keybinding editor with click-to-capture and conflict detection.
- **Config bridge:** `configBridge.ts` applies Rust config as CSS custom properties on `:root`. Handles theme color overrides (per dark/light/warm), heading styles (size + color for h1-h6), element styles (blockquote, links, code, tags), and spacing. Uses hook injection pattern (`setRemeasureHook`) to trigger CM6 `requestMeasure()` after font/sizing changes without circular imports.
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

### Path Allowlist (Orphan Files)
| Command | Signature |
|---------|-----------|
| `allow_path` | `(path: String) → ()` — whitelist a path outside registered dirs |
| `disallow_path` | `(path: String) → ()` — remove from allowlist |

### Config & Keybindings
| Command | Signature |
|---------|-----------|
| `get_config` | `() → Config` — full app config |
| `update_config` | `(json: String) → ()` — partial JSON patch, deep-merged into existing config |
| `get_keybindings` | `() → Vec<KeyBinding>` — user keybinding overrides |
| `save_keybindings` | `(json: String) → ()` — persist keybinding overrides |

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
- **Investigate: watcher self-write suppression vs IPC cache.** Verify that the file watcher's self-write suppression actually prevents `fs:change` emission to the frontend after Onyx's own saves. If it doesn't, the IPC cache (5s TTL) is being cleared on every auto-save and is effectively useless. Fix the watcher suppression if so.
- **Investigate: mtime map `.clear()` cap strategy.** The 500-entry cap uses `.clear()` which nukes all tracked mtimes. An LRU eviction would be more correct. Low severity — fallback is content comparison, not data loss. Swap to LRU if it causes issues in practice.
- **Auto-save stale path after rename:** `Editor.tsx:142` — The debounced save closure captures `tab.path` at edit time. If the user renames the file within the 500ms window and types, the save fires at the old (deleted) path. Narrow window but can create ghost files.
- **`unregister_directory` doesn't stop watcher:** `commands.rs:258` — `notify` watcher continues watching the removed directory. File modifications trigger reindexing with empty `dir_id`, polluting search results with orphan entries.
- **Orphan rename fails:** `commands.rs:493` — `validate_path` checks the new path against the allowlist, but only the old path was `allow_path`'d. Renaming an orphan note returns "Access denied".
- **Stale store in `openFileInEditor`:** `openFile.ts:29` — `getState()` snapshot goes stale across `await` boundaries. If the user switches tabs during IPC round-trips, `replaceActiveTab` can replace the wrong tab.
- **`dirs.rs` non-atomic save:** `dirs.rs:101` — Uses `fs::write()` instead of temp+rename. Crash during save truncates `directories.json`. Low probability.
- **Frontmatter auto-fold rAF race:** `frontmatter.ts:98` — `requestAnimationFrame` captures `view` from constructor. On rapid tab switch, the rAF fires after `setState()` loaded a different document, potentially folding the wrong range.
- **Inline formatting inside wikilinks:** `livePreview.ts` — Bold/italic regexes match inside `[[some *emphasized* link]]`, producing overlapping decorations. Cosmetic.

## Gotchas

- **Kill `cargo tauri dev` before making Rust changes.** The dev server watches Rust files and auto-rebuilds + relaunches the app on every save, causing repeated open/close cycles during multi-file edits. Stop the dev process first, make all backend changes, verify with `cargo check`, then relaunch once when ready to test.
- **`sharedExtensions` is cached at module level.** Built once on first Editor mount. HMR cannot rebuild them — changes to extension code (keymaps, decorations) require full app restart (`kill cargo tauri dev` + relaunch).
- `getCurrentWindow()` must be called lazily (in handlers), not at module/component level
- File watcher has `Drop` impl that signals shutdown and joins the debounce thread
- `unchecked_transaction` in db.rs is safe because all DB access is behind a Mutex
- File mutations must go through `fileOps.ts`, never direct `invoke()` — otherwise editor caches, tabs, and sidebar fall out of sync
- `replaceTabContent()` must be called after external writes (e.g. property panel) to sync CM6 state
- **WKWebView keyboard limitations:** Tauri uses WebKit, not Chromium. Some keyboard shortcuts (e.g. `Cmd+Shift+Arrow`) are consumed by the Cocoa text system before reaching JavaScript. Use the `mac` property on CM6 keybindings for platform-specific alternatives.
- **CSS layers vs CM6:** CodeMirror 6 injects its own styles at runtime **without** any CSS layer. Unlayered styles always beat layered styles regardless of specificity. Editor overrides (`.cm-content`, `.cm-scroller`, `.cm-editor`, etc.) must stay **outside** any `@layer` block in `layout.css`. Putting them in a layer will make them invisible — CM6 defaults will win.
- **Mtime conflict on first save:** The mtime map starts empty. First save of a file falls back to content comparison (no mtime recorded yet). After the first `read_file`, mtime is tracked and subsequent writes use the cheap mtime check.
- **Orphan files need `allow_path` before IPC.** Files outside registered directories are blocked by `validate_path`. Call `invoke("allow_path", { path })` before `read_file`/`write_file` for orphan files. `openFileInEditor` handles this automatically. On session restore, orphan paths are allowed before tab opening. On removal, `disallow_path` cleans up.
- **Mtime conflict surfaces in StatusBar.** When `write_file` rejects due to external modification, it returns `CONFLICT:` prefix. The auto-save catches this, sets `saveConflictPath` in the store, and the StatusBar shows a clickable reload prompt. Reloading re-reads from disk and clears the conflict.
- **CM6 cursor positioning: use padding, not margins.** `margin-top` on `.cm-line` breaks cursor calculations — CM6 doesn't account for margins in its character measurement. Use `padding-top` instead. After external CSS changes to font/sizing, call `requestMeasure()` via the `setRemeasureHook` pattern in `configBridge.ts`.
- **CM6 syntax highlight spans override line-level colour.** `Decoration.line({ class })` sets colour on `.cm-line`, but CM6's markdown grammar wraps text in `<span class="ͼX">` with its own `color`. Child spans must use `color: inherit !important` to respect the line-level colour (see `.cm-preview-heading *` in `livePreview.ts`).
- **Hook injection pattern for cross-module references.** When module A needs to call into module B but importing B from A would create a circular import, use the hook pattern: A exports `setXHook(fn)`, B calls it during init. Used for `setFlushSaveHook`, `setSnapshotEditorHook`, `setRemeasureHook`.
