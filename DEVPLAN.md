# Onyx — Development Plan

Each phase produces a usable milestone. Don't start the next phase until the current one is solid.

---

## Phase 1 — Skeleton

**Goal:** Empty Tauri app with the three-panel layout, a file tree that reads real directories, and a text editor that opens real files.

### Steps

1.1 **Scaffold Tauri 2 + React + TypeScript + Vite project**
- `npm create tauri-app` with React/TS template
- Add Tailwind CSS
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

**Milestone:** You can open the app, see your Zettelkasten folder tree, click a note, read it, edit it, and it saves automatically.

---

## Phase 2 — Core Editor

**Goal:** The editor feels good enough to write in daily. Tabs, frontmatter display, and basic navigation.

### Steps

2.1 **Tabs**
- Zustand store: open tabs, active tab, tab order
- Open file → add tab (or focus existing)
- Close tab (middle-click, X button, Cmd+W)
- Modified indicator (dot)
- Tab state persisted in Zustand (not across sessions yet)

2.2 **Frontmatter handling**
- Detect YAML frontmatter in CM6 (first `---` pair)
- Fold frontmatter by default, show a subtle collapsed header
- Parse frontmatter in Rust for later indexing

2.3 **Editor polish**
- Apply theme from mockup (Literata font, line height, content width)
- Line wrapping
- Cursor position + word count in status bar (live updates)
- Editor mode toggle (Live Preview vs Source) — start with Source only, stub the toggle

2.4 **File tree polish**
- Directory color accents
- Active file highlight in tree
- Right-click context menu: new note, new folder, rename, delete (to OS trash), reveal in Finder
- Refresh button per directory

2.5 **Quick open (Cmd+O)**
- Modal with text input
- Fuzzy search over all `.md` filenames in registered directories
- Results list, keyboard navigation (up/down/enter)
- Needs: Rust command to list all indexed filenames (flat scan on startup, no SQLite yet)

**Milestone:** Multi-tab editing with quick open. You can navigate your vault efficiently and write comfortably.

---

## Phase 3 — Index & Links

**Goal:** SQLite index powers backlinks, tags, and wikilink resolution. Notes feel connected.

### Steps

3.1 **SQLite setup in Rust**
- Create `~/.onyx/cache/index.db` on startup
- Schema from ARCHITECTURE.md (files, links, tags, bookmarks, object_types)
- Indexes

3.2 **Indexer**
- On startup: scan all registered directories, parse each `.md` file
- Extract: title (filename), frontmatter (as JSON), wikilinks, tags
- Insert into SQLite
- Delta re-index: compare `modified_at` vs file mtime, only re-index changed files
- Debounced re-index on file watcher events (3s)

3.3 **File watcher**
- `notify` crate watching all registered directories
- On file change/create/delete → update index + notify frontend via Tauri event
- Frontend refreshes file tree and backlinks on event

3.4 **Wikilink resolution**
- Rust command: `resolve_wikilink(link, context_dir) → Option<path>`
- Resolution order: same directory tree → cross-directory → unresolved

3.5 **CM6: wikilink extension**
- Syntax highlight `[[links]]` in the editor
- Cmd+Enter on a wikilink → resolve and open in current tab
- Broken links styled differently (dashed, red-ish)
- Click broken link → create note in same directory, open it

3.6 **CM6: tag extension**
- Syntax highlight `#tags`
- (No tag pane yet — just visual highlighting)

3.7 **Backlinks panel**
- Context panel section: query `links` table WHERE target matches current file
- Show source note title + context snippet
- Click backlink → open that note

3.8 **Bookmarks**
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

## Phase 5 — Periodic Notes & Calendar

**Goal:** Daily journaling workflow works. Calendar widget navigates and creates notes.

### Steps

5.1 **Periodic notes config**
- Load from `~/.onyx/periodic-notes.json`
- Bind to a registered directory

5.2 **Template engine**
- Parse `{{variable}}` syntax in Rust
- Support: `{{date}}`, `{{date:FORMAT}}`, `{{title}}`, `{{time}}`, `{{yesterday}}`, `{{tomorrow}}`, `{{last_year}}`, `{{cursor}}`

5.3 **Create periodic note**
- Rust command: `create_periodic_note(type, date) → path`
- Generates path from format string, creates folders if needed, applies template
- Returns path to frontend → open in editor

5.4 **Calendar widget**
- Month view in context panel (always visible)
- Today highlighted, `< TODAY >` navigation
- Click date → open or create daily note
- Dots on dates that have notes (query index by path pattern)
- Weekly note indicator on week numbers

5.5 **Cmd+Shift+D → open today's note**

**Milestone:** Full daily journaling workflow. Open app → see calendar → click today → write.

---

## Phase 6 — Blocks & Editor Extensions

**Goal:** Block operations work. Editor has outliner and table support.

### Steps

6.1 **Block awareness in CM6**
- Detect `***` separators
- Track block boundaries (line ranges)
- Visual: subtle separator line, block actions on hover (copy icon)

6.2 **Block operations**
- Copy block as markdown
- Move block up/down (reorder across separators)
- Delete block
- Extract block to new note (create note with block content, replace block with wikilink)

6.3 **Outliner extension**
- Tab / Shift+Tab to indent/outdent list items
- Alt+Up / Alt+Down to move list items
- Enter at end of list item creates new item
- Backspace on empty list item outdents or removes

6.4 **Table editing extension**
- Tab to move between cells
- Enter to move to next row
- Auto-align columns on format
- Add/remove rows and columns via context menu

6.5 **URL paste extension**
- Detect URL on clipboard + text selected → create `[text](url)` automatically

**Milestone:** Block-level note management and comfortable structured editing.

---

## Phase 7 — Live Preview & Polish

**Goal:** Live preview mode renders markdown inline. The app feels polished.

### Steps

7.1 **Live preview CM6 extension**
- Render headings (hide `#` when not focused on that line)
- Render bold/italic inline
- Render checkboxes as interactive widgets
- Render wikilinks as styled clickable elements
- Render tags as styled chips
- Render `![[embed]]` as full inline content (read-only, 2 levels deep)

7.2 **Split panes**
- Cmd+click opens in horizontal split
- Draggable divider
- Each pane has own tab bar
- Cmd+W closes pane if last tab

7.3 **Command palette (Cmd+P)**
- Modal with fuzzy search over all registered commands
- Every action is a command (open today, toggle sidebar, switch theme, etc.)
- Recent commands first
- Contextual commands (block ops only when in a block)

7.4 **Theming**
- Load themes from `~/.onyx/themes/`
- Ship dark + light built-in themes
- CSS custom properties controlled by theme JSON
- Theme switch via command palette

7.5 **Linting**
- Inline lint decorations in CM6
- Rules from ARCHITECTURE.md
- Auto-fix on save
- Status bar indicator

7.6 **Per-tab navigation stack**
- Back/forward history per tab (Cmd+[ / Cmd+])
- Maintained when following wikilinks

**Milestone:** The editor looks and feels great. Live preview makes writing pleasant. The app is genuinely usable as a daily driver.

---

## Phase 8 — MCP Server

**Goal:** Claude Code can read, search, and write to your notes through Onyx.

### Steps

8.1 **HTTP server in Rust**
- Separate thread, localhost:19532
- MCP protocol over streamable HTTP

8.2 **Read-only tools**
- `onyx_get_active`, `onyx_read_note`, `onyx_search`, `onyx_get_backlinks`, `onyx_get_tags`, `onyx_resolve_link`, `onyx_list_directory`, `onyx_get_properties`, `onyx_query_by_type`, `onyx_get_index_stats`, `onyx_get_object_types`, `onyx_get_periodic_config`

8.3 **Write tools with confirmation**
- `onyx_write_note`, `onyx_insert_at_cursor`, `onyx_insert_after_heading`, `onyx_append_to_note`, `onyx_update_frontmatter`, `onyx_create_note`
- Toast notification in Onyx UI: "Claude Code wants to write to Alice.md — Allow / Deny"
- Cursor position snapshotted at confirmation time

8.4 **State file**
- Write `~/.onyx/state.json` on file switch, selection change, window focus (1s debounce)

8.5 **Config**
- MCP enable/disable, port, write confirmation toggle in `config.json`

**Milestone:** Claude Code is vault-aware. You can ask it about your notes and it can read/write through Onyx.

---

## Phase 9 — Tier 2 Features

Build incrementally as desired:

- 9.1 Slash commands (`/h1`, `/table`, `/template`, `/divider`)
- 9.2 Custom keybindings (`~/.onyx/keybindings.json`)
- 9.3 Full-text search across files (Cmd+Shift+F) — ripgrep-style in Rust
- 9.4 Natural language dates (`@today` → `[[2026-03-09]]`)
- 9.5 Custom sort (drag-to-reorder in sidebar)
- 9.6 Heatmap calendar (activity visualization)
- 9.7 Print / PDF export
- 9.8 Canvas read-only viewer (parse `.canvas` JSON, render visual)

---

## Dev Principles

- **Don't build ahead.** Each phase should work fully before moving on.
- **Test with real notes.** Use the Zettelkasten from Phase 1 onward. If something feels wrong, fix it now.
- **Rust for data, React for pixels.** When in doubt about where logic goes, put it in Rust.
- **No premature abstraction.** Build the specific thing, refactor later if patterns emerge.
- **Ship each phase.** Tag a release at each milestone. v0.1 = Phase 1, v0.2 = Phase 2, etc.
