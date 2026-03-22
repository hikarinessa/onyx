# Onyx — Context for AI Assistants

Lightweight, offline-first markdown note-taking app. Tauri 2 + React 18 + CodeMirror 6 + SQLite.

## Key Documents

- `docs/ARCHITECTURE.md` — Full design spec (layout, data model, editor, theming, feature tiers)
- `docs/DEVPLAN.md` — 12-phase implementation plan with step-by-step breakdowns
- `docs/GUIDELINES.md` — Development rules (surface parity, code style, error handling)
- `docs/DEPENDENCIES.md` — Crate/package rationale
- `docs/DEBT.md` — Consolidated technical debt tracker
- `docs/ISSUES.md` — Issue tracking labels, defaults, and creation commands
- `docs/CHANGELOG.md` — Version history (features, fixes, breaking changes)

## Current Status

- **Phase 1–6:** Complete (skeleton → core editor → links → typed objects → file ops → hardening → periodic notes → backfill → command palette & theming)
- **Phase 7 (Live Preview & Navigation):** Complete
- **Phase 7.5 (Hardening & CSS Architecture):** Complete
- **Phase 7.6 (Settings Window):** Complete
- **Phase 7.7 (Lucide Icons):** Complete
- **Phase 7.8 (Polish & Deferred):** Complete
- **Phase 8 (Tables):** Complete
- **Phase 9 (Per-Block Features + Full-Text Search):** Complete
- **Phase 10 (Split Panes):** Complete
- **Phase 11 (Tier 2 Features):** In progress (slash commands, callouts, tag chips, 13 new themes, theme preview)

**Current version:** 0.10.2

## Project Structure

```
src/                          # Frontend (React + TypeScript)
├── main.tsx                  #   12 lines — React entry point
├── App.tsx                   #  680 lines — Root component, keybinding dispatch, command registration, menu events, fs:change handler
├── stores/
│   ├── app.ts                #  746 lines — Zustand store (pane-aware tabs, nav stack, panels, settings, memoized selectors)
│   └── panes.ts              #   40 lines — Pane types, constants, factory
├── components/
│   ├── Titlebar.tsx          #    8 lines — Custom titlebar with traffic lights spacer
│   ├── TabBar.tsx            #  103 lines — Per-pane tab strip with drag-to-reorder
│   ├── Sidebar.tsx           #  591 lines — File tree, collapsible dirs, inline rename, orphan notes
│   ├── BookmarkStrip.tsx     #  116 lines — Bookmarks section pinned at sidebar bottom
│   ├── SidebarContextMenu.tsx#  120 lines — Right-click context menu for file tree
│   ├── ErrorBoundary.tsx     #   50 lines — React error boundary
│   ├── Editor.tsx            #  625 lines — CM6 editor, inline title, live preview sync, split pane layout
│   ├── ContextPanel.tsx      #  669 lines — Calendar, backlinks, properties, outline, recent docs
│   ├── Calendar.tsx          #  273 lines — Month-grid calendar with week numbers
│   ├── StatusBar.tsx         #  110 lines — Cursor, word count, lint status, editor mode, file path, conflict/deleted indicators
│   ├── QuickOpen.tsx         #  264 lines — Cmd+O fuzzy search + type: prefix queries
│   ├── CommandPalette.tsx    #  123 lines — Cmd+P fuzzy command search
│   ├── Settings.tsx          # 1225 lines — Settings modal (config, keybindings, themes, templates, about)
│   ├── ThemePreview.tsx      #   95 lines — Live CM6 preview pane for Appearance settings
│   ├── Icon.tsx              #   20 lines — Lucide icon wrapper: <Icon name="folder" size={16} />
│   ├── IconPicker.tsx        #  105 lines — Modal icon picker with search + categories
│   ├── SearchPanel.tsx       #  247 lines — Full-text search panel (sidebar tab)
│   └── LintPanel.tsx         #   91 lines — Lint diagnostics panel (toggle from status bar)
├── extensions/
│   ├── frontmatter.ts        #  178 lines — CM6: frontmatter detection, styling, auto-fold, toggle-fold command
│   ├── wikilinks.ts          #  158 lines — CM6: wikilink syntax highlighting, click to follow
│   ├── tags.ts               #  109 lines — CM6: #tag syntax highlighting (viewport-aware)
│   ├── formatting.ts         #  118 lines — CM6: Cmd+B/I/Shift+C toggle wrap (multi-cursor safe)
│   ├── outliner.ts           #  160 lines — CM6: list item indent/outdent/move/enter
│   ├── urlPaste.ts           #   30 lines — CM6: URL paste → markdown link
│   ├── autocomplete.ts       #   99 lines — CM6: wikilink + tag + slash command autocomplete
│   ├── slashCommands.ts      #  175 lines — CM6: slash commands (/table, /code, /callout, /today, /template)
│   ├── livePreview.ts        # 1090 lines — CM6: live preview (headings, bold/italic, checkboxes, wikilinks, callouts, tag chips, fold)
│   ├── headingFold.ts        #   70 lines — CM6: foldService for heading-based section folding
│   ├── inlineSvgIcons.ts     #  115 lines — Compact SVG icon renderer for CM6 widgets (callouts, alt checkboxes)
│   ├── symbolWrap.ts         #   61 lines — CM6: wrap selection with brackets/quotes/markdown on type
│   ├── linting.ts            #  402 lines — CM6: markdown lint rules (10 autofix + 4 warning) + autofix on save
│   ├── spellcheck.ts         #  188 lines — CM6: macOS native spellcheck integration
│   ├── blocks.ts             #  398 lines — CM6: block detection, hover copy button (right margin), move/delete/extract
│   ├── tableAdapter.ts       #  188 lines — CM6: md-advanced-tables adapter (0-indexed↔1-indexed)
│   └── tableEditor.ts        #  175 lines — CM6: table keymap (Tab/Enter) + TSV paste + command palette
├── lib/
│   ├── fileOps.ts            #  169 lines — Centralized file mutations (with link warnings, fs:change event-driven)
│   ├── openFile.ts           #   87 lines — Shared open-file-in-editor utility (with nav stack, orphan detection)
│   ├── periodicNotes.ts      #   37 lines — Create/open periodic notes utility
│   ├── recentDocs.ts         #   68 lines — Recent documents tracking (localStorage ring buffer)
│   ├── session.ts            #  280 lines — Tab/panel/pane state persistence (~/.onyx/session.json)
│   ├── ipcCache.ts           #   40 lines — TTL-based IPC query cache (reduces redundant Rust calls)
│   ├── commands.ts           #   33 lines — Command registry for palette + menu bar
│   ├── keybindings.ts        #  174 lines — Keybinding registry (parse, normalise, conflict detect, global keymap)
│   ├── themes.ts             #  137 lines — Theme system (18 built-in themes, data-theme attribute switching)
│   ├── configBridge.ts       #  286 lines — Config bridge: loads Rust config → CSS custom properties, remeasure hook
│   ├── configTypes.ts        #   87 lines — Typed config schema + defaults
│   └── iconCatalog.ts        #  363 lines — Curated ~250 Lucide icons + category metadata
└── styles/
    ├── reset.css             #   67 lines — CSS reset (@layer reset, prefers-reduced-motion)
    ├── theme.css             #  760 lines — CSS layer order + custom properties (18 themes via data-theme)
    └── layout.css            # 2980 lines — Layout/component styles (@layer layout, components) + unlayered editor overrides

src-tauri/                    # Backend (Rust)
├── Cargo.toml                # Dependencies
├── tauri.conf.json           # Window config, dev URL, CSP
└── src/
    ├── main.rs               #    6 lines — Entry point
    ├── lib.rs                #  260 lines — Tauri setup, native menu bar, AppState, App Nap prevention, plugins
    ├── commands.rs           # 1283 lines — Tauri commands (file ops, search, bookmarks, autocomplete, config, keybindings, spellcheck)
    ├── config.rs             #  397 lines — App config + keybinding persistence (~/.onyx/config.json, keybindings.json)
    ├── db.rs                 #  629 lines — SQLite (WAL, files/links/tags/bookmarks + tag/title queries, reconciliation)
    ├── dirs.rs               #  135 lines — Directory registration (~/.onyx/directories.json)
    ├── indexer.rs            #  387 lines — Background indexer (frontmatter, wikilinks, tags) + startup reconciliation
    ├── watcher.rs            #  247 lines — File watcher with debounced reindex + rescan handling
    ├── object_types.rs       #  134 lines — Type registry (~/.onyx/object-types.json)
    ├── periodic.rs           #  448 lines — Periodic notes config, template engine, date formatting
    ├── paths.rs              #   22 lines — Onyx data directory resolution
    └── plugins/
        └── mac_rounded_corners.rs # 217 lines — macOS window corner radius fix
```

**Total:** ~20,400 lines (12,400 TS/TSX + 4,200 Rust + 3,800 CSS)

## Architecture Essentials

For full architecture details, see `docs/ARCHITECTURE.md`. Key patterns an AI assistant must know:

- **State split:** Zustand owns UI state (tabs, panels, nav stacks). CM6 owns editor state (content, undo, cursor). Rust owns file data + index.
- **Split panes:** Up to 3 panes, each with own tabs and `EditorView`. Pane state lives in `paneState` (array of `Pane` objects). **Do not use `store.tabs` or `store.activeTabId` from imperative code** — these compat getters are broken by Zustand's `Object.assign` merge. Use `selectAllTabs()` or read `paneState.panes` directly.
- **Editor pattern:** One `EditorView` per pane, state swapped via `setState()` on tab switch. `EditorState` cached per tab (preserves undo/cursor/scroll). Module-level `activeTabIdBox` object for cross-closure communication.
- **File mutations:** All through `src/lib/fileOps.ts` which does synchronous UI updates (tabs, caches, tree) for responsiveness. Rust commands also emit `fs:change` events for external consumers (calendar, backlinks, recent docs). Components never call `invoke("rename_file")` etc. directly.
- **File system reactivity:** Rust emits `fs:change` events from both watcher (external changes) and commands (internal mutations). App.tsx has a central handler that manages tab lifecycle, cache invalidation, and tree refresh. Remove events are buffered 300ms to handle the macOS watcher race with rename events.
- **CSS layers vs CM6:** `@layer reset, tokens, base, layout, components` for specificity control. Editor styles are **unlayered** (must compete with CM6's unlayered runtime styles). Theming via `data-theme` attribute on `:root`.
- **Type-only imports:** CM6 types like `Extension`, `DecorationSet` must use `import type` or `type` keyword — they don't exist at runtime.
- **Hook injection pattern:** When module A needs to call into module B but importing B from A would create a circular import, A exports `setXHook(fn)`, B calls it during init. Used for `setFlushSaveHook`, `setSnapshotEditorHook`, `setRemeasureHook`.
- **No Tailwind.** Plain CSS with custom properties.

## IPC Commands

All Tauri commands are defined in `src-tauri/src/commands.rs`. See that file for full signatures. Major groups: file ops, directory management, search & index, bookmarks (directory + global), typed objects & frontmatter (`get_object_types`, `save_object_types`, `update_frontmatter`), periodic notes, autocomplete & metadata, session, path allowlist (orphan files), config & keybindings.

## Build & Run

```bash
cargo tauri dev          # Dev server (Vite HMR + Rust hot reload)
cargo check              # Rust type check (use instead of full build to save RAM)
cargo test               # Rust unit tests
npx tsc --noEmit         # TypeScript type check
```

## GitHub Issues

Every issue must have exactly one label from each category: **Priority**, **Type**, **Status**. Defaults: `P3-Medium`, `Task`, `Backlog`. See `docs/ISSUES.md` for full label list and creation commands.

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
- **Zustand compat getters (`store.tabs`, `store.activeTabId`) are broken for imperative access.** Zustand's `set()` does `Object.assign({}, state, partial)` which invokes `get` accessors and copies the return value as a plain property. After the first `set()`, these getters freeze into stale snapshots. React selectors (`useAppStore(s => s.tabs)`) work because they re-run on state change. **For imperative code** (fileOps, event handlers, etc.), use `selectAllTabs(useAppStore.getState())` or read `paneState.panes` directly.
- **Session restore must be idempotent.** React StrictMode runs effects twice in dev. Never use `toggle*` functions in `restoreSession()` — the second call undoes the first. Use `useAppStore.setState()` directly with the saved values.
- **Tauri intercepts HTML5 drag-drop on macOS.** `dragDropEnabled` defaults to true, which means Tauri's native handler swallows `onDrop` events. Use pointer events (`onPointerDown`/`onPointerMove`/`onPointerUp`) for internal drag-and-drop. Keep Tauri's native handler for external Finder drops only.
- **CM6 cursor positioning: use padding, not margins.** `margin-top` on `.cm-line` breaks cursor calculations. Use `padding-top` instead. After external CSS changes to font/sizing, call `requestMeasure()` via the `setRemeasureHook` pattern in `configBridge.ts`.
- **CM6 line decoration CSS needs `!important`.** `Decoration.line({ class })` adds the class to `.cm-line`, but CM6 sets `padding: 0 2px` on `.cm-line` via runtime-injected styles. These runtime styles beat static CSS regardless of specificity or layer. Use `!important` on `padding-left`, `border-left`, etc. for line decoration classes. Margins on `.cm-line` should be avoided entirely (per CM6 author).
- **CM6 syntax highlight spans override line-level colour.** `Decoration.line({ class })` sets colour on `.cm-line`, but CM6's markdown grammar wraps text in `<span class="ͼX">` with its own `color`. Child spans must use `color: inherit !important` to respect the line-level colour.
- **CM6 ViewPlugin cannot create multi-line replace decorations.** `Decoration.replace()` from a ViewPlugin must not cross line boundaries. Multi-line replaces (block-level) must come from a `StateField` with `provide: EditorView.decorations.from(f)`. Violating this causes infinite viewport growth. See `tableBlockField` in `livePreview.ts` for the correct pattern.
- **CM6 DOM is not your DOM — never use DOM text/classes for click dispatch.** CM6's syntax highlighting splits text into multiple `<span>` elements with opaque classes (`ͼ12`, `ͼ13`). Mark decorations from ViewPlugins (e.g. `.cm-preview-wikilink`) may not produce findable DOM targets — `target.closest(".cm-preview-wikilink")` can return null even when the decoration exists in the DecorationSet. `el.textContent` on a mark span may return partial text (e.g. a URL without its `https://` prefix). **All click handlers must use `view.posAtCoords({ x, y })` to get the document position, then regex-match against the line text to determine what was clicked.** The document model is the source of truth; the DOM is a rendering artifact.
- **CM6 click handler ownership: one dispatcher, not many.** Link-like click handling (wikilinks, URLs, embeds) should live in a single `EditorView.domEventHandlers` registration with a clear priority chain: check wikilink regex → check markdown link regex → check bare URL regex → return false. Splitting click dispatch across multiple extensions (e.g. wikilinks.ts and livePreview.ts) leads to handler ordering bugs, duplicated logic, and interactions that are impossible to debug.
