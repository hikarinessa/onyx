# Onyx — Development Plan

Each phase produces a usable milestone. Don't start the next phase until the current one is solid.

## Versioning

Version tracks phase completion: `0.PHASE.PATCH`. The phase number is the minor version.

| Phase | Version |
|-------|---------|
| Phase 1 (Skeleton) | 0.1.0 |
| Phase 2 (Core Editor) | 0.2.0 |
| Phase 3 (Links & Connections) | 0.3.0 |
| Phase 4 (Typed Objects) | 0.4.0 |
| Phase 4.5 (File Ops & Cache) | 0.4.5 |
| Phase 4.6 (Hardening) | 0.4.6 |
| Phase 5 (Periodic Notes) | 0.5.0 |
| Phase 5.X (Backfill) | 0.5.X |
| Phase 6 (Palette & Theming) | 0.6.0 |
| Phase 7 (Preview & Panes) | 0.7.0 |
| Phase 8 (Blocks & Tables) | 0.8.0 |
| Phase 9 (MCP Server) | 0.9.0 |
| Phase 10 (Tier 2) | 0.10.0 |

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

6.7 **Outliner extension**
- Tab / Shift+Tab to indent/outdent list items
- Alt+Up / Alt+Down to move list items
- Enter at end of list item creates new item
- Backspace on empty list item outdents or removes

6.8 **URL paste extension**
- Detect URL on clipboard + text selected → create `[text](url)` automatically

**Milestone:** The app is keyboard-discoverable and visually customizable. Command palette makes every action findable.

---

## Phase 7 — Live Preview & Split Panes

**Goal:** Live preview mode renders markdown inline. Split panes for side-by-side editing. The app becomes a genuine daily driver.

**Note:** This is the single biggest "daily driver" feature. Users will tolerate source-only editing for a while, but live preview is what makes the editor feel native and pleasant. Prioritize this over power-editing features (blocks, tables).

### Steps

7.1 **Live preview CM6 extension**
- Render headings (hide `#` when not focused on that line)
- Render bold/italic inline
- Render checkboxes as interactive widgets
- Render wikilinks as styled clickable elements
- Render tags as styled chips
- Render `![[embed]]` as full inline content (read-only, 2 levels deep)
- **Prerequisite:** Debt item #11 (full-doc decoration scan) should be addressed before or during this step — switch wikilink/tag extensions to viewport-aware iteration, since live preview adds significantly more decorations

7.2 **Cmd+/ — Editor mode toggle**
- Toggle between Live Preview and Source mode
- Persist per-tab preference in session

7.3 **Outline section in context panel**
- Collapsible accordion section showing document headings (H1–H6)
- Click heading → scroll editor to that position
- Updates live as user edits

7.4 **Split panes**
- Cmd+click opens in horizontal split
- Draggable divider
- Each pane has own tab bar
- Cmd+W closes pane if last tab

7.5 **Per-tab navigation stack**
- Back/forward history per tab (Cmd+[ / Cmd+])
- Maintained when following wikilinks
- Capped at 50 entries per tab (drop oldest)

7.6 **Linting**
- Inline lint decorations in CM6
- Rules from ARCHITECTURE.md
- Auto-fix on save configurable via `config.json` linting section (`enabled`, `fixOnSave`, `rules`)
- Status bar indicator

**Milestone:** The editor looks and feels great. Live preview makes writing pleasant. The app is genuinely usable as a daily driver.

---

## Phase 8 — Blocks, Tables & Power Editing

**Goal:** Block-level operations and structured editing. The editor becomes a power tool.

**Rationale (reordered from original plan):** Block operations and table editing are high-complexity features that touch every layer (parser, decorations, commands, file mutations). They're valuable but not blocking daily-driver usage. Building them after live preview means the editing foundation is mature and well-tested.

### Steps

8.1 **Block awareness in CM6**
- Detect `***` separators
- Track block boundaries (line ranges)
- Visual: subtle separator line, block actions on hover (copy icon)

8.2 **Block operations**
- Copy block as markdown
- Move block up/down (reorder across separators)
- Delete block
- Extract block to new note (create note with block content, replace block with wikilink)

8.3 **Table editing extension**
- Tab to move between cells
- Enter to move to next row
- Auto-align columns on format
- Add/remove rows and columns via context menu

**Milestone:** The editor handles structured content — blocks can be moved, extracted, and tables can be edited inline.

---

## Phase 9 — MCP Server

**Goal:** Claude Code can read, search, and write to your notes through Onyx.

### Steps

9.1 **HTTP server in Rust**
- Separate thread, localhost:19532
- MCP protocol over streamable HTTP

9.2 **Read-only tools**
- `onyx_get_active`, `onyx_read_note`, `onyx_search`, `onyx_get_backlinks`, `onyx_get_tags`, `onyx_resolve_link`, `onyx_list_directory`, `onyx_get_properties`, `onyx_query_by_type`, `onyx_get_index_stats`, `onyx_get_object_types`, `onyx_get_periodic_config`

9.3 **Write tools with confirmation**
- `onyx_write_note`, `onyx_insert_at_cursor`, `onyx_insert_after_heading`, `onyx_append_to_note`, `onyx_update_frontmatter`, `onyx_create_note`
- Toast notification in Onyx UI: "Claude Code wants to write to Alice.md — Allow / Deny"
- Cursor position snapshotted at confirmation time

9.4 **State file**
- Write `~/.onyx/state.json` on file switch, selection change, window focus (1s debounce)

9.5 **Config**
- MCP enable/disable, port, write confirmation toggle in `config.json`

**Milestone:** Claude Code is vault-aware. You can ask it about your notes and it can read/write through Onyx.

---

## Phase 10 — Tier 2 Features

Build incrementally as desired:

- 10.1 Slash commands (`/h1`, `/table`, `/template`, `/divider`)
- 10.2 Custom keybindings (`~/.onyx/keybindings.json`)
- 10.3 Full-text search across files (Cmd+Shift+F) — ripgrep-style in Rust
- 10.4 Natural language dates (`@today` → `[[2026-03-11]]`)
- 10.5 Custom sort (drag-to-reorder in sidebar)
- 10.6 Sort by modified date (sidebar sort mode toggle)
- 10.7 Heatmap calendar (activity visualization)
- 10.8 Tracker widgets (inline charts from frontmatter data)
- 10.9 Text extraction / OCR (images, PDFs)
- 10.10 Print / PDF export
- 10.11 Canvas read-only viewer (parse `.canvas` JSON, render visual)

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
