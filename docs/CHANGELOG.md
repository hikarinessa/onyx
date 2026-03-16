# Changelog

All notable changes to Onyx. Follows [Keep a Changelog](https://keepachangelog.com/).

---

## [0.10.0] — 2026-03-15

### Added
- **Split panes** — up to 3 editor panes with independent tab bars, draggable divider, Cmd+\ to split
- **Pane shortcuts** — Cmd+1/2/3 focus, Cmd+Shift+| move tab, Cmd+click wikilink opens in other pane
- **Scroll lock** — synchronized scrolling between panes with offset anchoring
- **File system reactivity** — unified `fs:change` event bus for all file mutations (internal + external)
- **Startup reconciliation** — diffs disk vs SQLite index on launch, prunes stale entries, adds missing files
- **Auto-save guard** — `deletedPaths` set prevents ghost file resurrection on external delete
- **Tab lifecycle** — clean tabs auto-close on external delete, dirty tabs get visual indicator (strikethrough)
- **External modify handling** — clean tabs auto-reload (content-hash check), dirty tabs show conflict prompt
- **Backlink resolution** — new files auto-resolve dangling `target_id = NULL` links immediately
- **Rescan handling** — FSEvents overflow triggers targeted directory reconciliation
- **Session restore validation** — skips deleted files instead of failing

### Fixed
- Renaming a file no longer creates ghost "Untitled" + empty file (#18)
- Sidebar tree updates on external file system changes (#10)
- Deleting open file no longer re-saves it via auto-save (#8)
- Calendar dots update when files are deleted externally (#7)
- Recent docs cleaned up on file delete/rename (#11)
- Zustand compat getter (`store.tabs`) returning stale data in imperative code
- Periodic note creation now fully indexes links/tags/frontmatter

### Changed
- `full_scan` replaced by `reconcile` — startup indexing is now incremental (only re-indexes changed files)
- `fileOps.ts` does synchronous UI updates for responsiveness; event handler is idempotent backup
- Remove events buffered 300ms to handle macOS watcher rename race
- `write_file` returns `DELETED:` error code (distinct from `CONFLICT:`) when file no longer exists

## [0.10.1] — 2026-03-16

### Added
- **Object type editor** — Settings → Objects tab with master-detail CRUD, property type dropdown, drag-to-reorder
- **Enum property support** — select/multiselect properties with inline pill editor for options
- **Inline property creation** — "+Add property" row in properties panel with Enter to confirm
- **Type assignment** — assign/change/remove object type via badge in properties header
- **Property type icons** — all 8 property types (text, number, date, checkbox, select, multiselect, tags, link) have Lucide icons
- **Right-click type picker** — change property input type on untyped notes via context menu
- **New folder button** — root directory right-click context menu (New Note, New Folder, Reveal in Finder, Unregister)
- **Drag-drop files into folders** — pointer-based drag in sidebar tree (bypasses Tauri native handler)
- **Hide empty folders** — setting to hide folders with no .md files (default on)
- **Delete daily notes** — right-click calendar date to delete periodic note
- **Command palette Tab/Shift+Tab** — keyboard navigation + scroll-into-view

### Fixed
- Cmd+Option+[ now toggles sidebar instead of folding text (#15)
- Finder file moves update sidebar tree (#23)
- Bookmark icon changed from star to bookmark (#21)
- Property delete/add now works (was broken by stale Zustand compat getter)
- Viewport-clamped context menus (no more overflow off-screen)
- Typed property labels use accent color for visual distinction

### Changed
- Directory headers brighter (text-primary), folder labels dimmer (text-secondary)
- Context menus more compact (4px padding), letter-spacing 0.08em on all uppercase
- Properties panel sections reduced padding
- Object types load once on mount (not per-file), fixing assign button on empty notes

---

## [0.9.0] — 2026-03-14

### Added
- **Full-text search** — Cmd+Shift+F search across all files with preview snippets
- **Block operations** — copy, delete, extract-to-new-note with hover button
- **Lint panel** — markdown linting with 10 autofix + 4 warning rules, autofix on save
- **Spellcheck** — macOS native spellcheck via NSSpellChecker integration

---

## [0.8.0] — 2026-03-14

### Added
- **Table editing** — Tab/Enter navigation, column/row operations, TSV paste, sort, transpose
- **Table formatting** — auto-format on save, alignment (left/center/right)

---

## [0.7.8] — 2026-03-14

### Added
- **Icon picker** — modal picker with search + categories for directory icons
- **Lucide icons** — curated catalog of ~250 icons

### Fixed
- Various UI polish items from Phase 7.5–7.8

---

## [0.7.0] — 2026-03-13

### Added
- **Live preview** — headings, bold/italic, checkboxes, wikilinks, strikethrough, highlight
- **Command palette** — Cmd+P fuzzy command search
- **Theming** — dark/light/warm themes via `data-theme` attribute
- **Settings window** — config, keybindings, themes, about
- **Periodic notes** — daily/weekly/monthly with templates and calendar navigation
