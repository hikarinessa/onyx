# Onyx — Context for AI Assistants

Lightweight, offline-first markdown note-taking app. Tauri 2 + React 18 + CodeMirror 6 + SQLite.

## Key Documents

- `docs/ARCHITECTURE.md` — Full design spec (layout, data model, editor, theming, feature tiers)
- `docs/DEVPLAN.md` — 12-phase implementation plan with step-by-step breakdowns
- `docs/GUIDELINES.md` — Development rules (surface parity, code style, error handling)
- `docs/DEPENDENCIES.md` — Crate/package rationale
- `docs/DEBT.md` — Consolidated technical debt tracker

## Current Status

- **Phase 1–6:** Complete (skeleton → core editor → links → typed objects → file ops → hardening → periodic notes → backfill → command palette & theming)
- **Phase 7 (Live Preview & Navigation):** Complete
- **Phase 7.5 (Hardening & CSS Architecture):** Complete
- **Phase 7.6 (Settings Window):** Complete
- **Phase 7.7 (Lucide Icons):** Complete
- **Phase 7.8 (Polish & Deferred):** Complete
- **Phase 8 (Tables):** Complete
- **Phase 9 (Per-Block Features + Full-Text Search):** Complete
- **Phase 10 (Split Panes):** Planned
- **Phase 11 (Tier 2 Features):** Planned

**Current version:** 0.9.0

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
│   ├── IconPicker.tsx        #  100 lines — Modal icon picker with search + categories
│   └── SearchPanel.tsx       #  247 lines — Full-text search panel (sidebar tab)
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
│   ├── linting.ts            #  310 lines — CM6: markdown lint rules (10 autofix + 4 warning) + autofix on save
│   ├── blocks.ts             #  398 lines — CM6: block detection, hover copy button, move/delete/extract
│   ├── tableAdapter.ts       #  187 lines — CM6: md-advanced-tables adapter (0-indexed↔1-indexed)
│   └── tableEditor.ts        #  175 lines — CM6: table keymap (Tab/Enter) + TSV paste + command palette
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

For full architecture details, see `docs/ARCHITECTURE.md`. Key patterns an AI assistant must know:

- **State split:** Zustand owns UI state (tabs, panels, nav stacks). CM6 owns editor state (content, undo, cursor). Rust owns file data + index.
- **Editor pattern:** Single persistent `EditorView`, state swapped via `setState()` on tab switch. `EditorState` cached per tab (preserves undo/cursor/scroll). Module-level `activeTabIdBox` object for cross-closure communication.
- **File mutations:** All through `src/lib/fileOps.ts` which owns the full sequence: disk → DB → tabs → editor caches → tree refresh. Components never call `invoke("rename_file")` etc. directly.
- **CSS layers vs CM6:** `@layer reset, tokens, base, layout, components` for specificity control. Editor styles are **unlayered** (must compete with CM6's unlayered runtime styles). Theming via `data-theme` attribute on `:root`.
- **Type-only imports:** CM6 types like `Extension`, `DecorationSet` must use `import type` or `type` keyword — they don't exist at runtime.
- **Hook injection pattern:** When module A needs to call into module B but importing B from A would create a circular import, A exports `setXHook(fn)`, B calls it during init. Used for `setFlushSaveHook`, `setSnapshotEditorHook`, `setRemeasureHook`.
- **No Tailwind.** Plain CSS with custom properties.

## IPC Commands

All Tauri commands are defined in `src-tauri/src/commands.rs`. See that file for full signatures. Major groups: file ops, directory management, search & index, bookmarks (directory + global), typed objects & frontmatter, periodic notes, autocomplete & metadata, session, path allowlist (orphan files), config & keybindings.

## Build & Run

```bash
cargo tauri dev          # Dev server (Vite HMR + Rust hot reload)
cargo check              # Rust type check (use instead of full build to save RAM)
cargo test               # Rust unit tests
npx tsc --noEmit         # TypeScript type check
```

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
- **Orphan files need `allow_path` before IPC.** Files outside registered directories are blocked by `validate_path`. Call `invoke("allow_path", { path })` before `read_file`/`write_file` for orphan files. `openFileInEditor` handles this automatically.
- **Mtime conflict surfaces in StatusBar.** When `write_file` rejects due to external modification, it returns `CONFLICT:` prefix. The auto-save catches this, sets `saveConflictPath` in the store, and the StatusBar shows a clickable reload prompt.
- **CM6 cursor positioning: use padding, not margins.** `margin-top` on `.cm-line` breaks cursor calculations. Use `padding-top` instead. After external CSS changes to font/sizing, call `requestMeasure()` via the `setRemeasureHook` pattern in `configBridge.ts`.
- **CM6 syntax highlight spans override line-level colour.** `Decoration.line({ class })` sets colour on `.cm-line`, but CM6's markdown grammar wraps text in `<span class="ͼX">` with its own `color`. Child spans must use `color: inherit !important` to respect the line-level colour.
