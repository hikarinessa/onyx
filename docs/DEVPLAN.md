# Onyx — Development Plan

Each phase produces a usable milestone. Don't start the next phase until the current one is solid.

## Versioning

Version tracks phase completion: `0.PHASE.PATCH`. The phase number is the minor version.

| Phase | Version |
|-------|---------|
| Phase 1 (Skeleton) | 0.1.0 |
| Phase 2 (Core Editor) | 0.2.0 |
| Phase 3 (Links & Connections) | 0.3.0 |
| Phase 4 (Typed Objects) | 0.4.0 ✅ |
| Phase 4.5 (File Ops & Cache) | 0.4.5 ✅ |
| Phase 4.6 (Hardening) | 0.4.6 ✅ |
| Phase 5 (Periodic Notes) | 0.5.0 ✅ |
| Phase 5.X (Backfill) | 0.5.X ✅ |
| Phase 6 (Palette & Theming) | 0.6.0 ✅ |
| Phase 7 (Preview & Navigation) | 0.7.0 ✅ |
| Phase 7.5 (Hardening & CSS) | 0.7.5 ✅ |
| Phase 7.6 (Settings Window) | 0.7.6 ✅ |
| Phase 7.7 (Lucide Icons) | 0.7.7 ✅ |
| Phase 7.8 (Polish & Deferred) | 0.7.8 ✅ |
| Phase 8 (Tables) | 0.8.0 ✅ |
| Phase 9 (Per-Block Features + Full-Text Search) | 0.9.0 ✅ |
| Phase 10 (Split Panes + FS Reactivity) | 0.10.0 ✅ |
| Phase 11 (Tier 2 Features) | 0.11.0 |

Patch increments (`0.X.PATCH`) are for fixes and additions within a phase.

---

## Phase 1 — Skeleton

**Goal:** Empty Tauri app with the three-panel layout, a file tree that reads real directories, and a text editor that opens real files.

### Steps

1.1 **Scaffold Tauri 2 + React + TypeScript + Vite project**
- `npm create tauri-app` with React/TS template
- Set up CSS architecture (reset, custom properties, theme variables)
- Verify it builds and opens a window

1.2 **App shell layout**
- Three-panel CSS layout: sidebar, editor, context panel (empty for now)
- Titlebar with traffic lights
- Tab bar (static, one tab)
- Status bar (static text)
- Sidebar and context panel toggle with Cmd+Option+[ and Cmd+Option+]
- Get the sizing, borders, and dark theme right from the start (use mockup as reference)

1.3 **Rust: directory registration and file listing**
- Tauri command: `list_directory(path) → Vec<DirEntry>`
- Store registered directories in `~/.onyx/directories.json`
- Create the `~/.onyx/` config directory on first launch

1.4 **Sidebar: live file tree**
- Read from Rust backend, render directory trees
- Lazy-load on expand
- Click a `.md` file → send path to editor area
- Ignore patterns (`.obsidian`, `.git`, `node_modules`)

1.5 **CodeMirror 6 basic setup**
- Install CM6 with markdown language support
- Wire it up: click file in sidebar → Rust reads file → content appears in CM6
- Basic markdown syntax highlighting
- Editable

1.6 **Rust: read and write files**
- `read_file(path) → String`
- `write_file(path, content) → ()`
- Auto-save: frontend debounces 500ms, calls `write_file`
- **Guard against empty writes:** track a dirty flag per tab — only auto-save if the user has made an edit since the last load. Prevents overwriting files with empty content during CM6 initialization.

1.7 **File watcher (basic)**
- `notify` crate watching all registered directories
- On file change/create/delete → emit Tauri event to frontend → refresh file tree
- **Self-write ignore:** after Onyx writes a file, suppress watcher events for that path for 2s to avoid feedback loops
- No indexing yet — just keeps the sidebar in sync

**Milestone:** You can open the app, see your Zettelkasten folder tree, click a note, read it, edit it, and it saves automatically. File tree stays in sync when files change on disk.

---

## Phase 2 — Core Editor

**Goal:** The editor feels good enough to write in daily. Tabs, frontmatter display, and basic navigation.

### Steps

2.1 **SQLite setup in Rust**
- Create `~/.onyx/cache/index.db` on startup
- Schema from ARCHITECTURE.md (files, links, tags, bookmarks, object_types + indexes)
- Initial indexer: scan registered directories on a **background thread**, index filenames + paths + frontmatter
- Emit progress events to frontend ("Indexing... 342/1204 files")
- App is usable (file tree, editing) while indexing completes
- Delta re-index on file watcher events (3s debounce)

2.2 **Tabs**
- Zustand store: open tabs, active tab, tab order
- Open file → add tab (or focus existing)
- Close tab (middle-click, X button, Cmd+W)
- Modified indicator (dot)

2.3 **Session state persistence**
- Save open tabs + active tab + sidebar state to `~/.onyx/session.json` on quit
- Restore on launch — reopen previous tabs
- Prevents losing your workspace on every restart

2.4 **Frontmatter handling**
- Detect YAML frontmatter in CM6 (first `---` pair)
- Fold frontmatter by default, show a subtle collapsed header
- Parse frontmatter in Rust during indexing

2.5 **Editor polish**
- Apply theme from mockup (Literata font, line height, content width)
- Line wrapping
- Cursor position + word count in status bar (live updates)
- Editor mode toggle (Live Preview vs Source) — start with Source only, stub the toggle

2.6 **File tree polish**
- Directory color accents
- Active file highlight in tree
- Right-click context menu: new note, new folder, rename, delete (to OS trash), reveal in Finder
- Refresh button per directory

2.7 **Quick open (Cmd+O)**
- Modal with text input
- Fuzzy search over filenames from SQLite index (async, results stream in as indexing progresses)
- Results list, keyboard navigation (up/down/enter)

**Milestone:** Multi-tab editing with quick open and session restore. You can navigate your vault efficiently and write comfortably.

---

## Phase 3 — Links & Connections

**Goal:** Wikilinks resolve, backlinks work, tags highlight. Notes feel connected.

### Steps

3.1 **Full indexer**
- Extend the Phase 2 indexer to also extract: wikilinks, tags
- Populate `links` and `tags` tables
- File watcher triggers re-index of changed files (3s debounce, background thread)

3.2 **Wikilink resolution**
- Rust command: `resolve_wikilink(link, context_dir) → Option<path>`
- Resolution order: same directory tree → cross-directory → unresolved

3.3 **CM6: wikilink extension**
- Syntax highlight `[[links]]` in the editor
- Cmd+Enter on a wikilink → resolve and open in current tab
- Broken links styled differently (dashed, red-ish)
- Click broken link → show small "Create note?" tooltip, confirm to create in same directory

3.4 **CM6: tag extension**
- Syntax highlight `#tags`
- (No tag pane yet — just visual highlighting)

3.5 **Backlinks panel**
- Context panel section: query `links` table WHERE target matches current file
- Show source note title + context snippet
- Click backlink → open that note
- Shows "Indexing..." while initial index is in progress

3.6 **Bookmarks**
- Star/unstar current note (Cmd+Shift+B or similar)
- Bookmarks section pinned at sidebar bottom
- Stored in SQLite `bookmarks` table

**Milestone:** Your notes are connected. Wikilinks resolve, backlinks show who links to you, and the index stays in sync as you edit.

---

## Phase 4 — Typed Objects & Properties

**Goal:** Notes with types get a structured property editor. Your People notes feel first-class.

### Steps

4.1 **Object type registry**
- Load type definitions from `~/.onyx/object-types.json`
- Rust command: `get_object_types() → Vec<ObjectType>`
- Ship with example types (Person, Book) based on the user's actual usage

4.2 **Property editor in context panel**
- When active note has `type:` in frontmatter, show property editor
- Render fields based on type definition (text inputs, date pickers, select dropdowns, tag chips)
- Editing a property → update YAML frontmatter → auto-save
- For untyped notes, show raw key-value frontmatter editor

4.3 **Frontmatter queries**
- Rust command: `query_by_type(type_name) → Vec<FileInfo>`
- `json_extract` on frontmatter column
- Wire into quick open: `type:person` filter prefix

**Milestone:** Your People folder feels like a proper contacts database, but it's all just markdown files.

---

## Phase 4.5 — File Operations & Cache Integrity

**Goal:** Every basic file operation (create, rename, delete, reveal) works end-to-end without stale state. The foundation is solid before building higher-level features.

**Context:** Phase 4 added Rust commands for file operations and sidebar UI, but mutations don't propagate to all cached locations (editor state, tabs, sidebar subtree). Renaming a file updates the tab but leaves the sidebar stale and editor caches keyed to the old path.

### Steps

4.5.1 **`fileOps.ts` — centralized mutation module**
- Create `src/lib/fileOps.ts` with functions: `createNote`, `renameFile`, `deleteFile`, `createFolder`, `revealInFinder`
- Each function owns the full sequence: disk → DB → tabs → editor caches → tree refresh
- Components call `fileOps.*`, never `invoke("rename_file")` etc. directly
- Export from a single module so the mutation contract is obvious

4.5.2 **`fileTreeVersion` in Zustand**
- Add `fileTreeVersion: number` and `bumpFileTreeVersion()` to app store
- Sidebar `TreeNode` subscribes to `fileTreeVersion` — when it bumps, re-fetch children for expanded nodes
- `loadDirectories()` already refreshes roots; this handles subtree staleness
- All `fileOps.*` functions call `bumpFileTreeVersion()` as their last step

4.5.3 **Editor cache migration**
- Export `migrateEditorCache(oldPath, newPath)` from `Editor.tsx` — moves entries in `editorStateCache`, `lastSavedContent`, `scrollCache` from old key to new key
- Export `clearEditorCache(path)` — deletes all cached state for a path (used by delete)
- `fileOps.renameFile` calls `migrateEditorCache` after `updateTabPath`
- `fileOps.deleteFile` calls `clearEditorCache` then `closeTab`

4.5.4 **Wire Sidebar to fileOps**
- Replace all direct `invoke()` calls in Sidebar context menu handlers with `fileOps.*`
- `handleRenameSubmit` → `fileOps.renameFile(oldPath, newPath)`
- `handleDelete` → `fileOps.deleteFile(path)`
- `handleNewFolder` → `fileOps.createFolder(path)`
- `handleReveal` → `fileOps.revealInFinder(path)`
- New note creation → `fileOps.createNote(dirPath)` which creates, indexes, opens tab, and enters rename mode

4.5.5 **Create-note-with-rename flow**
- `fileOps.createNote` creates `Untitled.md` (or `Untitled 1.md` etc.) via Rust
- Opens the new file in a tab
- Returns the path; Sidebar enters inline rename mode for that path
- On rename submit → `fileOps.renameFile` handles the full cascade
- On rename cancel (Escape/blur with no change) → file keeps "Untitled" name (no delete)

4.5.6 **Folder operations**
- `fileOps.renameFolder(oldPath, newPath)` — renames on disk, bulk-updates all `files` rows with matching path prefix in DB, migrates all affected editor caches and tabs
- `fileOps.deleteFolder(path)` — trashes on disk, bulk-deletes DB entries, closes all affected tabs, clears all affected editor caches
- Wire to sidebar context menu

4.5.7 **Verify & test**
- Manual test matrix: create note → rename → verify tab/sidebar/editor all reflect new name → delete → verify tab closes, sidebar removes entry, editor cache cleared
- Test rename of file that has backlinks (DB paths update, backlinks still resolve)
- Test delete of bookmarked file (cascade removes bookmark, sidebar bookmarks section updates)

**Milestone:** All basic file operations work reliably. No stale sidebar entries, no broken tabs after rename, no orphaned editor caches. The app handles files as well as a native file manager.

---

## Phase 4.6 — Hardening

**Goal:** Fix known fragilities and close structural gaps before building new features on top. Everything here is low-effort, high-impact.

**Context:** Post-Phase 4.5 review identified several issues that are cheap to fix now but expensive to work around later. None are architectural changes — they're targeted fixes to the existing foundation.

### Steps

4.6.1 **File watcher shutdown signal**
- Add an `AtomicBool` (or `oneshot::channel`) shutdown flag to the watcher's debounce thread
- Check the flag each loop iteration; break on signal
- `FileWatcher::drop()` sets the flag and joins the thread
- Reference: Otterly's `watcher/service.rs` for the pattern
- Fixes debt item #8 — without this, unregistering/re-registering directories leaks threads, and app quit may hang

4.6.2 **React error boundary**
- Add an error boundary component wrapping the editor and sidebar
- On crash: render a fallback UI with "Something went wrong" + a button to reload the panel
- Prevents a component-level throw from white-screening the entire app (which would prevent the user from saving)
- ~15 lines of code, no dependencies

4.6.3 **Move session persistence off localStorage**
- Replace `localStorage` in `src/lib/session.ts` with a Rust command that reads/writes `~/.onyx/session.json`
- localStorage is synchronous, size-limited (5-10MB), and doesn't survive WebKit cache clears
- The DEVPLAN §2.3 already specifies `~/.onyx/session.json` as the target — implementation drifted to localStorage
- Add Rust commands: `read_session() → Option<String>` and `write_session(json: String) → ()`
- Keep the 30s auto-save interval and `beforeunload` flush

4.6.4 **Extract Sidebar sub-components**
- Sidebar.tsx is 627 lines handling: file tree, bookmark strip, context menus, inline rename, directory add/remove
- Extract `BookmarkStrip` and `SidebarContextMenu` into sibling components in `src/components/`
- No behavior changes — purely structural, reduces the risk surface for Phase 5+ feature additions
- Natural seam: bookmarks are already a visually distinct section pinned at the bottom

4.6.5 **Verify & smoke test**
- `cargo check`, `cargo test`, `npx tsc --noEmit` — all must pass
- Launch with `cargo tauri dev`, confirm: session restores from `~/.onyx/session.json`, error boundary catches a simulated throw, file watcher thread exits cleanly on directory unregister

**Milestone:** The foundation is hardened. No thread leaks, no white-screen risk, no fragile persistence. Ready to build periodic notes on a solid base.

---

## Phase 5 — Periodic Notes & Calendar

**Goal:** Daily journaling workflow works. Calendar widget navigates and creates notes.

### Steps

5.1 **Periodic notes config**
- Load from `~/.onyx/periodic-notes.json`
- Bind to a registered directory (user picks which one)
- Consider per-directory config if needed later, but start global — keep it simple for now

5.2 **Template engine**
- Parse `{{variable}}` syntax in Rust using minijinja
- Support: `{{date}}`, `{{date:FORMAT}}`, `{{title}}`, `{{time}}`, `{{yesterday}}`, `{{tomorrow}}`, `{{last_year}}`, `{{cursor}}`
- **Design decision:** `{{yesterday}}` and `{{tomorrow}}` render as wikilinks (`[[2026-03-07]]`), not bare dates — the user navigates between periodic notes via links
- **Edge case:** If the template references `{{yesterday}}` and yesterday's note doesn't exist, the wikilink is rendered anyway (it's a link to a note that will be created on click). Don't try to create the target note eagerly.
- **Unit tests:** Write Rust tests for the template engine — date formatting, variable substitution, edge cases (leap years, year boundaries, week numbering). This is pure-function code, easy and valuable to test.

5.3 **Create periodic note**
- Rust command: `create_periodic_note(type, date) → path`
- Generates path from format string, creates folders if needed, applies template
- **Idempotent:** If the note already exists, return its path without overwriting. Frontend opens it either way.
- Returns path to frontend → open in editor
- **Unit tests:** Test path generation for daily/weekly/monthly across date boundaries

5.4 **Calendar widget**
- Month view in context panel (always visible), using `react-day-picker`
- Today highlighted, `< TODAY >` navigation
- Click date → open or create daily note
- Dots on dates that have notes (query index by path pattern)
- Weekly note indicator on week numbers
- **Performance:** The "which dates have notes" query runs on every month navigation. Use a path-prefix query against the `files` table (`WHERE path LIKE 'Calendar/2026/2026-03/%'`), not a full table scan. If this becomes a bottleneck at scale, add a dedicated path-pattern index.

5.5 **Cmd+Shift+D → open today's note**

5.6 **Recent documents**
- Track last 20 opened files in a ring buffer (deduplicated by path, most recent first)
- Store in `~/.onyx/state.json` (or extend session data) — persists across launches
- Record on every `openFileInEditor` call
- Collapsible accordion section in ContextPanel (below calendar, above backlinks)
- Click entry → open file in editor
- Clear button to reset history

**Milestone:** Full daily journaling workflow. Open app → see calendar → click today → write. Recent documents provide quick re-access to working files.

---

## Phase 5.X — Backfill (Missed from Phases 1–5)

**Goal:** Fill gaps between ARCHITECTURE.md spec and what was actually built. Small, targeted additions.

### Autocomplete

5.7 **Wikilink autocomplete**
- Typing `[[` triggers autocomplete popup with suggestions from file index
- Fuzzy match on filename, sorted by relevance
- Enter/Tab to accept, Escape to dismiss

5.8 **Tag autocomplete**
- Typing `#` triggers autocomplete popup with suggestions from tag index
- Shows existing tags with usage counts

### Keyboard shortcuts

5.9 **Cmd+N — New note in current directory**
- Creates Untitled.md in the directory of the active file (or first registered dir if no file open)
- Opens in editor, enters rename mode

5.10 **Cmd+K — Insert wikilink**
- Opens a mini-picker (similar to quick open) at cursor position
- Select file → inserts `[[filename]]` at cursor

5.11 **Cmd+Shift+N — New note from template**
- Opens a template picker showing available templates
- Select template → creates note from template in current directory

5.12 **Formatting shortcuts**
- Cmd+B → bold (`**selection**`)
- Cmd+I → italic (`*selection*`)
- Cmd+Shift+C → inline code (`` `selection` ``)
- Works on selection; if no selection, wraps word at cursor

### Sidebar & status bar

5.13 **Unresolved link count badges in sidebar**
- File tree items show a small badge with count of broken outgoing wikilinks
- Query `links` table for unresolved links per file

5.14 **Delete warns about incoming links**
- Before deleting a file, check `links` table for notes that link TO this file
- If any exist, show confirmation: "3 notes link to this file. Delete anyway?"

5.15 **Status bar enhancements**
- Character count on hover (tooltip over word count)
- File path display (click to copy to clipboard)

### Tabs

5.16 **Tab drag-to-reorder**
- Drag tabs to change order in the tab bar
- Update Zustand tab order on drop

---

## Phase 6 — Command Palette, Theming & Editor Polish

**Goal:** The app becomes comfortable, customizable, and keyboard-discoverable. Every action is a command.

**Rationale (reordered from original plan):** Command palette and theming are high-value, low-risk features that make the app feel complete. Block operations and table editing are higher complexity and can wait — users will forgive missing block ops but not a source-only editor. Live preview (Phase 7) is the bigger daily-driver unlock; this phase sets the stage.

### Steps

6.1 **Command palette (Cmd+P)**
- Modal with fuzzy search over all registered commands
- Every action is a command (open today, toggle sidebar, switch theme, etc.)
- Recent commands shown first
- Contextual commands (block ops only when cursor is in a block)

6.2 **Theming**
- Load themes from `~/.onyx/themes/`
- Ship dark + light built-in themes
- CSS custom properties controlled by theme JSON
- Theme switch via command palette

6.3 **Find & Replace**
- Cmd+F — find in current file (wire CM6's `@codemirror/search`, already a dependency)
- Cmd+H — find and replace
- Styled to match Onyx theme

6.4 **Native menu bar**
- Build via `tauri::menu` — File, Edit, View, Go, Format, Window, Help
- Menu items map to registered commands (same as command palette)
- Standard items: New Note, Open, Close Tab, Undo/Redo, Find, Zoom, About Onyx
- Keyboard shortcuts reference accessible from Help menu

6.5 **Settings UI**
- Accessible from command palette or menu bar
- Load/save `~/.onyx/config.json`
- Editor settings: autoSaveDelay, tabSize, lineNumbers, autoPairs, spellcheck
- Layout: sidebar.width, contextPanel.width, contextPanel.sections order
- Files: defaultNoteLocation
- Periodic notes config (currently requires manual JSON editing)

6.6 **Additional themes**
- Ship warm-toned theme alongside dark + light
- Per-element styling overrides: headings, code blocks, blockquotes, links can have individual color/size within a theme

6.7 **Collapsible directories in sidebar**
- Click directory header to collapse/expand its file tree
- Persist collapsed state per directory in session
- Collapsed directories still show the header with a chevron indicator

6.8 **Outliner extension**
- Tab / Shift+Tab to indent/outdent list items
- Alt+Up / Alt+Down to move list items
- Enter at end of list item creates new item
- Backspace on empty list item outdents or removes

6.9 **URL paste extension**
- Detect URL on clipboard + text selected → create `[text](url)` automatically

**Milestone:** The app is keyboard-discoverable and visually customizable. Command palette makes every action findable.

---

## Phase 7 — Live Preview & Navigation ✅

**Goal:** Live preview mode renders markdown inline. Navigation and UX polish make the app a genuine daily driver.

### Completed

7.0 **Viewport-aware decorations** ✅ — Wikilinks, tags, live preview all use `view.visibleRanges`
7.1 **Live preview CM6 extension** ✅ — Headings, bold/italic/bold-italic, strikethrough, highlight, checkboxes, wikilinks. Focus-line shows raw markdown.
7.2 **Cmd+/ editor mode toggle** ✅ — Per-tab, persisted, default is preview
7.3 **Per-tab navigation stack** ✅ — Cmd+[/], mouse 3/4, 50-entry cap
7.4 **Inline editable title** ✅ — Editable H1 above editor, renames file on commit
7.5 **Editor polish** ✅ — Italic uses `_`, symbol wrap extended, outliner Option+Up/Down, layout restructure

### Deferred (completed in later phases)

- **Split panes** ✅ — Phase 10
- **Outline section** ✅ — Phase 7.5
- **Linting** ✅ — Phase 9
- **Embeds** — `![[note]]` rendered inline (read-only, 2-level depth cap) → #39
- **Tag chips** — Tags rendered as styled chips in live preview → #40

**Milestone:** The editor looks and feels great. Live preview makes writing pleasant. The app is genuinely usable as a daily driver.

---

## Phase 7.5 — Foundation Hardening & CSS Architecture ✅

**Goal:** Strengthen the foundation before complex feature work. High-impact, low-risk changes across architecture, CSS, and known gotchas.

### Architecture

7.5.1 **Zustand selector audit** ✅ — Memoized `selectActiveTab`/`selectActiveTabPath`/`selectActiveEditorMode` selectors; StatusBar, BookmarkStrip, ContextPanel updated to use them
7.5.2 **IPC query cache** ✅ — `src/lib/ipcCache.ts` with TTL-based cache; backlinks cached in ContextPanel; invalidated on `fs:change`
7.5.3 **Command pattern deepening** ✅ — Registered Next/Previous Tab, Reveal in Finder, Copy File Path; added Ctrl+Tab/Ctrl+Shift+Tab shortcuts

### CSS

7.5.4 **`@layer` declarations** ✅ — `@layer reset, tokens, base, layout, components` in theme.css. Editor styles kept **unlayered** (CM6 injects unlayered runtime styles that would override layered ones)
7.5.5 **`data-theme` attribute switching** ✅ — Light/warm themes defined in CSS as `:root[data-theme="light"]`/`:root[data-theme="warm"]`. JS `applyTheme()` sets `dataset.theme`. Dark is bare `:root` default
7.5.6 **CM6 theme bridge to CSS variables** — Deferred to Phase 8 (requires syntax token variable mapping)
7.5.7 **`prefers-reduced-motion`** ✅ — Blanket `0.01ms` duration/delay in `@layer reset` of reset.css

### Tech Stack Gotchas

7.5.8 **App Nap prevention** ✅ — `NSProcessInfo.beginActivityWithOptions` in lib.rs with `0x00FFFFFF` flags
7.5.9 **Async listener cleanup** ✅ — Cancellation flag pattern added to App.tsx menu/fs listeners and ContextPanel effects
7.5.10 **`scroll-behavior: smooth` audit** ✅ — Verified: no global `scroll-behavior: smooth` in CSS

### Note-App Gotchas

7.5.11 **mtime check before write** ✅ — `read_file` records mtime in `last_read_mtimes` map; `write_file` checks mtime before writing, rejects if externally modified. Map capped at 500 entries
7.5.12 **Self-write detection audit** ✅ — Handled via `fs:change` event architecture in Phase 10
7.5.13 **No-op write optimization** ✅ — Combined with mtime check: mtime-first (cheap), content fallback only on first save

### Orphan Notes & External File Opening

7.5.14 **Orphan notes sidebar section** ✅ — `orphanPaths` in Zustand, persisted in session. Sidebar shows orphan section. `openFileInEditor` detects files outside registered dirs
7.5.15 **Drag-drop `.md` files** — Deferred to Phase 8
7.5.16 **Finder "Open With Onyx"** — Deferred to Phase 8

### Deferred from Phase 7 (completed in later phases)

7.5.17 **Linting extension** ✅ — Implemented in Phase 9
7.5.18 **Outline section in context panel** ✅ — Implemented in Phase 6

**Milestone:** The app is hardened — CSS is layered, themes switch cleanly, IPC is cached, timers survive App Nap, external edits don't silently overwrite. Linting and outline round out the editor experience.

---

## Phase 7.6 — Settings Window

**Goal:** Centralized, in-app settings UI. Replaces manual JSON editing for all user-facing configuration. Includes a keybinding editor with capture and conflict detection.

**Rationale:** Config surface has grown across 7 phases — themes, periodic notes, object types, directories, editor preferences, keybindings. Users currently need to know about `~/.onyx/*.json` files. A settings window makes the app self-contained and lets us add new options without documentation burden.

### Infrastructure

7.6.1 **Unified config file** (`~/.onyx/config.json`)
- Single Rust-side config struct covering all general settings
- Sections: `editor`, `appearance`, `behavior`, `keybindings`
- Rust commands: `get_config` → full config JSON, `update_config(section, json)` → partial update
- Config is loaded at startup, cached in `AppState`, written on change
- Backward-compatible: missing keys use defaults, unknown keys are preserved

7.6.2 **Settings window component** (`SettingsWindow.tsx`)
- Modal overlay (like QuickOpen/CommandPalette) — not a separate Tauri window
- Opened via `Cmd+,` (standard macOS) and command palette
- Left sidebar with section nav, right content area
- Sections: General, Editor, Appearance, Periodic Notes, Keybindings, Directories, About

### Sections

7.6.3 **General**
- Auto-save interval (slider: 250ms–5000ms, default 500ms)
- Spellcheck toggle (maps to `contenteditable` spellcheck attribute)
- Default new note location (dropdown: first registered dir, or last active dir)

7.6.4 **Editor**
- Font family (text input with preview, default Literata)
- Font size (slider: 12–24px, default 16px)
- Line height (slider: 1.2–2.4, default 1.7)
- Content max-width (slider: 500–1200px or "none", default 720px)
- Default editor mode for new tabs: Preview or Source
- Show line numbers in source mode (toggle, default on)
- Tab size for code blocks (2/4/8, default 4)

7.6.5 **Appearance**
- Theme picker (visual cards showing each theme's colors)
- Sidebar width (slider: 180–400px, default 240px)
- Context panel width (slider: 220–400px, default 280px)
- UI font override (text input, default DM Sans)
- Monospace font override (text input, default IBM Plex Mono)

7.6.6 **Periodic Notes**
- Visual editor for `~/.onyx/periodic-notes.json`
- Enable/disable toggles per period type (daily, weekly, monthly)
- Path templates with live preview of resolved path
- Template file picker (file chooser within registered dirs)
- Date format customization

7.6.7 **Keybindings**
- Table: Command name | Current shortcut | Default shortcut
- Searchable/filterable by command name or category
- Click a shortcut cell → enters capture mode (records next key combo)
- Conflict detection: highlight if another command uses the same binding
- Reset individual binding to default, or reset all
- Stored in `~/.onyx/keybindings.json` — overrides only (not full dump)
- Keybinding registry: all commands declare their default binding, the registry merges defaults with user overrides

7.6.8 **Directories**
- Same as current sidebar "Add Folder" but with reorder, label/color editing, and remove
- Drag to reorder directory display order
- Color picker for directory accent color
- Inline label editing

7.6.9 **About**
- Version, build info
- Links: GitHub repo, changelog
- Storage stats: indexed files count, DB size, cache size

### Keybinding System

7.6.10 **Keybinding registry** (`src/lib/keybindings.ts`)
- All shortcuts currently hardcoded in `App.tsx` and CM6 keymaps move to a central registry
- Each entry: `{ id, key, defaultKey, scope: "global" | "editor" }`
- Global shortcuts wired via `window.addEventListener("keydown")` from registry
- Editor shortcuts wired via CM6 `keymap.of()` built from registry
- User overrides loaded from `~/.onyx/keybindings.json` at startup
- Conflicts: warn in settings UI, last-registered wins at runtime

7.6.11 **Keybinding capture widget**
- Focused input that records `e.metaKey + e.altKey + e.shiftKey + e.key`
- Renders as human-readable string: "Cmd+Shift+D"
- Escape cancels capture, Enter/blur confirms
- Shows conflict inline if another command binds the same combo

### Deferred from 7.5

7.6.12 **Linting extension** (carried forward)
- `@codemirror/lint` with markdown rules
- Auto-fix on save: trim trailing whitespace, ensure final newline
- Settings: enable/disable individual lint rules

7.6.13 **Drag-drop `.md` files** (carried forward)
- Handle Tauri `drag-drop` event on the window
- Open in editor, add to orphan section if not in a registered directory

7.6.14 **Finder "Open With Onyx"** (carried forward)
- Register `.md` file association in `tauri.conf.json`
- Handle Tauri `open-file` event

**Milestone:** Every user-facing setting is editable from within the app. Keybindings are fully customizable. No more manual JSON editing required for basic configuration.

---

## Phase 8 — Tables ✅

**Status:** Complete (v0.8.0). Implemented using `@tgrosinger/md-advanced-tables` (MIT) with CM6 adapter.

- Live preview renders tables as styled HTML widgets (StateField block decorations)
- Tab/Shift-Tab/Enter/Escape cell navigation
- 16 command palette commands (insert/delete rows+cols, move, align, sort, transpose, format)
- TSV paste auto-converts to GFM tables
- See `PHASE9_PLAN.md` for implementation details (file retains original name)

---

## Phase 9 — Per-Block Features + Full-Text Search

**Goal:** Block-level operations on top of the existing markdown editor (NOT a block-based editor switch), plus cross-file full-text search.

**TODO:** Create detailed feature design together before implementation. The candidates below are starting points for that design session.

### Block Features

9.1 **Block awareness in CM6** ✅
- Blocks defined as CommonMark block-level elements (paragraphs, headings, lists, code blocks, tables, etc.)
- StateField computes block ranges from Lezer syntax tree
- Subtle top-border on hovered block boundary

9.2 **Block operations** ✅
- Floating copy icon appears on hover (left of block, both source + preview mode)
- Copy block as markdown (gutter click or command palette)
- Move block up/down (Cmd+Shift+Up/Down)
- Delete block (command palette)
- Extract block to new note (command palette — replaces block with wikilink)

9.3 **Block references** — Deferred to Phase 11 (with transclusion)
- `^block-id` syntax, lazy ID generation, SQLite index
- Only useful once transclusion or block-level navigation exists

9.4 **Transclusion** — Deferred to Phase 11
- `![[note#^block-id]]` rendered inline (read-only)
- 2-level depth cap with cycle detection
- Ship block references + transclusion together

### Full-Text Search ✅

9.5 **Rust search backend**
- `search_content` command walks registered dirs + orphan files
- Case-insensitive substring match, .md only, 1MB cap, max 500 results
- Ranked: title matches first (shorter = better), then by match count

9.6 **Search UI**
- Sidebar tabs (Files / Search), Cmd+Shift+F to activate
- Debounced input, results grouped by file with expandable line matches
- Click line match → opens file at that position

**Milestone:** Blocks are operable (copy, move, delete, extract). Full-text search across all notes via Cmd+Shift+F. Block references and transclusion deferred to ship together.

---

## Phase 10 — Split Panes + FS Reactivity ✅

**Goal:** Two-pane editing with independent tab bars + unified file system reactivity.

### Split Panes (complete)
- ✅ Pane-aware Zustand store (array-based, max 3 panes)
- ✅ `EditorPane` extraction, per-pane `TabBar`, draggable divider
- ✅ Cmd+click wikilink → open in other pane; Cmd+Shift+Click → open in next pane
- ✅ Pane shortcuts (Cmd+1/2/3 focus, Cmd+Shift+| move tab, Cmd+\ split)
- ✅ Scroll lock: synchronized scrolling between panes
- ✅ Session persistence for pane layout + split ratios

### FS Reactivity (complete)
- ✅ Rust commands emit `fs:change` events (create/remove/rename) for all mutations
- ✅ Startup reconciliation replaces full_scan (diffs disk vs DB, prunes stale entries)
- ✅ Auto-save guard (`deletedPaths` set + `DELETED:` error code from Rust)
- ✅ Tab lifecycle: clean tabs close on external delete, dirty tabs get visual indicator
- ✅ External modify: auto-reload clean tabs (content-hash check), conflict prompt for dirty
- ✅ Backlink resolution: new files auto-resolve dangling `target_id = NULL` links
- ✅ Rescan handling: FSEvents overflow triggers targeted directory reconciliation
- ✅ Remove events buffered 300ms to handle macOS watcher rename race

See `docs/Archive/FS_REACTIVITY_SPEC.md` for the original design spec.

---

## Phase 11 — Tier 2 Features

Build incrementally as desired. Includes original Tier 2 items plus medium-priority research findings.

### Core Tier 2

- 11.1 Slash commands (`/h1`, `/table`, `/template`, `/divider`)
- 11.2 Natural language dates (`@today` → `[[2026-03-11]]`)
- 11.3 Custom sort (drag-to-reorder in sidebar)
- 11.4 Sort by modified date (sidebar sort mode toggle)
- 11.5 Heatmap calendar (activity visualization)
- 11.6 Tracker widgets (inline charts from frontmatter data)
- 11.7 Text extraction / OCR (images, PDFs)
- 11.8 Print / PDF export
- 11.9 Canvas read-only viewer (parse `.canvas` JSON, render visual)

### Architecture (when hitting pain points)

- 11.A1 Sidebar virtualization (react-vtree) — when file tree > 2,000 nodes
- 11.A2 Zustand store splitting — when `app.ts` > 600 lines
- 11.A3 Composition root extraction — when `App.tsx` wiring > 100 lines
- 11.A4 External file conflict detection UI — when users report data loss
- 11.A5 Search result streaming (Tauri channels) — when search > 300ms
- 11.A6 External change → apply as CM6 transaction (preserves undo history)

### CSS & Theming (medium term)

- 11.C1 OKLCH primitive color tokens — accent color picker derives variants from one hue
- 11.C2 **User-created themes** — `~/.onyx/themes/*.json` loaded at startup, appear alongside built-ins in Settings. Each file defines a theme with:
  - `name`, `id`, optional `base` (inherit from "dark"/"light"/"warm" — only override what you change)
  - `colors` section: all 9 base colors (bg_base, bg_surface, bg_elevated, text_primary/secondary/tertiary, accent, border_default/subtle) plus derived (hover, active, muted, tag, link, status)
  - `headings` section: per-level size + color
  - `elements` section: blockquote, link, code, tag styling
  - Infrastructure already exists: `configBridge.ts` applies vars, `theme.css` defines `data-theme` selectors, Settings has per-theme color tabs. Remaining work: Rust `load_user_themes()` to scan `~/.onyx/themes/`, dynamic CSS injection for user themes (can't use static `theme.css` selectors), theme import/export in Settings, "Duplicate theme" button to fork a built-in
- 11.C3 Theme editor/preview — live preview, contrast ratio warnings, "Save as theme" button to export current overrides

### Deferred Gotchas (when scale demands)

- 11.G1 Incremental startup indexing (track mtime, skip unchanged) — needed at 10K+ files
- 11.G2 IPC pagination for large result sets — needed when vaults grow
- 11.G3 Memory profiling during extended sessions
- 11.G4 IME/dead key testing with non-Latin keyboards

### Deferred from Phase 7

- 11.D1 Embeds — `![[note]]` rendered inline (read-only, 2-level depth cap)
- 11.D2 Tag chips — Tags rendered as styled chips in live preview

---

## Dev Principles

- **Don't build ahead.** Each phase should work fully before moving on.
- **Test with real notes.** Use the Zettelkasten from Phase 1 onward. If something feels wrong, fix it now.
- **Rust for data, React for pixels.** When in doubt about where logic goes, put it in Rust.
- **No premature abstraction.** Build the specific thing, refactor later if patterns emerge.
- **Ship each phase.** Tag a release at each milestone.
- **Test what matters.** Write Rust unit tests for pure-function code (parsers, template engine, date path generation). These are high-ROI — well-defined inputs/outputs, no mocking. Don't backfill tests for everything, but establish the habit for new code.
- **Background-first for heavy work.** Indexing, scanning, and search always run on background threads. The UI must never block.
- **Protect user data.** Dirty flags before auto-save, self-write suppression on file watcher, confirmation on destructive link actions.
