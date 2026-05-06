# Changelog

All notable changes to Onyx. Follows [Keep a Changelog](https://keepachangelog.com/).

---

## [0.10.9] — 2026-05-06

### Added
- **Periodic notes settings UI** — per-period cards (daily/weekly/monthly) covering enable toggle, directory dropdown, path format, template picker, and live path preview. Format-token help popover (#49)
- **Folder rules** — `~/.onyx/folder-rules.json` maps folders to a template or a script for new-note initial content; periodic-note paths take precedence
- **User scripts** — `~/.onyx/scripts/` discovered on startup with optional `<name>.json` sidecar (display name, palette visibility, timeout). New `{{ script("name", ...args) }}` minijinja function exposes context via env vars (`ONYX_NOTE_PATH`/`DATE`/`TITLE`/`DIR`); palette-visible scripts insert stdout at the cursor
- **Block: Sort Task List by Status** command — sorts the bullet list at cursor by checkbox state (plain → `[!]` → `[ ]` → `[/]` → `[<]` → `[>]` → `[x]` → `[-]` → extras), subtree-preserving, stable within tiers. Refuses ordered lists and lists without checkboxes
- **Light-dim styling for scheduled/delegated tasks** — `[<]` and `[>]` checkbox items now render at 0.7 opacity (vs. 0.5 for done/cancelled) in live preview
- **Release-build logging** — `tauri-plugin-log` is now active in release builds at Warn level (previously dev-only)

### Fixed
- `{{ cursor }}` (with whitespace) in templates not applying — `periodic.rs` now matches `\{\{\s*cursor\s*\}\}`; `EditorPane` rebuilds cached state with the cursor selection threaded through
- Template cursor offset not reaching the editor on newly created notes — `createStateWithExtensions` accepts an optional cursor position seeded into the `EditorState`'s selection; `loadFileIntoCache`, `fileOps.createNote`, and `periodicNotes.createOrOpenPeriodicNote` updated
  - Caveat: Rust offsets are byte-based, CM6 positions are UTF-16 code units; ASCII templates match, non-ASCII before the cursor will drift
- **Indexer churn under `.claude` directories** — skip Claude Code's high-churn data subdirs (`file-history`, `telemetry`, `todos`, `agent-state`, `session-env`, `paste-cache`, `backups`, `shell-snapshots`, `tasks`, `statsig`, `sessions`, `ide`, `debug`, `cache`) when nested under any `.claude` ancestor. Markdown content under `.claude/` is still indexed.

### Docs
- Update issue tracking docs to reflect new label scheme — Type-only labels (Bug/Task), Priority/Status managed via the GitHub Project board

### Known limitations
- Sort Task List: cursor lands at CM6's default-mapped position rather than next to the original item (tracked in `docs/DEBT.md`)
- Sort Task List: blank-line ownership shifts in loose lists after sort — cosmetic in rendered output, visible in raw markdown (tracked in `docs/DEBT.md`)

---

## [0.10.8] — 2026-04-16

### Fixed
- Folders intermittently disappearing from the sidebar tree (#103)
  - `reconcile()` now reindexes before pruning stale entries, closing the empty-folder window during folder-rename-while-closed or bulk external renames
  - `has_files_under`, `get_indexed_paths_by_prefix`, `delete_by_prefix`, and `rename_dir_prefix` now escape `%`/`_`/`\` in path prefixes and use `ESCAPE '\\'`; folders with these chars in their names no longer cause false-negative/over-matching LIKE queries
  - Sidebar `loadDirectories` preserves prior entries on transient per-directory IPC errors instead of blanking them; `TreeNode` refetch no longer clears children on error

---

## [0.10.5] — 2026-03-27

### Added
- **Hidden comments** — `%%text%%` inline and block syntax, hidden in preview, visible on cursor line (#64)
- **Alt checkbox slash commands** — `/> /< // /- /!` transform or insert alt checkboxes; basic checkbox states (space, x, /, -, >, <, !) clickable to toggle
- **Active file highlight** — sidebar tree and calendar bold/accent on the currently open file (#56)
- **Directory reorder** — drag-to-reorder registered directories in sidebar (#60)

### Fixed
- Cursor position offset with live preview decorations — `drawSelection()`, config-aware widget heights, table wrapper div, `height:0` instead of `display:none` for hidden lines (#55)
- Backlinks and bookmarks not updating on tab switch — frozen `activeTabId` compat getter replaced across 12 call sites (#61, #63)
- Wikilinks with explicit paths and `.md` extension — double `.md` prevention, directory-root-relative resolution (#58)
- Cursor placement after decorations at line end — `inclusiveEnd: false` on closing replace decorations, `coordsAtPos` guard in click handler (#79)
- Non-atomic saves in `dirs.rs` and `object_types.rs` — temp+rename pattern, static `TEMP_COUNTER` (#66, #67)
- Bookmark loss on re-indexing — unified bookmarks into standalone JSON file, decoupled from SQLite index (#65)
- Table formatting in live preview — batch `transact()`, monospace font on focused tables (#17)

### Changed
- Themes trimmed from 18 to 7 (dark, light, cream, sakura, velvet, reef, midnight); warm2 renamed to dark, old dark renamed to midnight
- CSP enabled (`default-src 'self'`), `allow_path` blocks dangerous system/home paths (#68)
- Dead legacy global bookmark code removed, `commit_file()` helper extracted, mtime eviction improved, compat getters removed (#72)

---

## [0.10.4] — 2026-03-24

### Added
- **Drag-to-reorder directories** — pointer-based drag on directory headers in sidebar, persisted to directories.json (#60)

### Fixed
- Table formatting in live preview: batch `transact()` for correct column padding, monospace font on focused tables (#17)
- Backlinks and bookmarks not updating on tab switch — replaced frozen `activeTabId` compat getter with `activeTabPath` selector (#61)

---

## [0.10.3] — 2026-03-23

### Added
- **Clickable URLs** — bare URLs and markdown links open in the default browser (#54). Source mode: Cmd+click. Preview mode: single click. Markdown links hide syntax and show display text only.
- `tauri-plugin-opener` dependency for external URL opening

### Changed
- `wikilinks.ts` now owns all link click dispatch (wikilinks + URLs) via `posAtCoords` + regex against document text
- livePreview plugin handles URL visual decorations only (no click logic)

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
