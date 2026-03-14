# Onyx — Architecture Document

**Version:** 0.8 (Phase 8 Complete)
**Date:** 2026-03-14

---

## 1. Vision

A lightweight, fast, offline-first markdown note-taking app that respects your existing files.

**What it is:** A local-first editor for markdown notes with backlinks, typed objects, periodic journaling, and block-level operations — built on Tauri so it uses 30-50MB RAM instead of Obsidian's 300-800MB.

**What it isn't:** A plugin platform, a sync service, or a database. Your notes are markdown files on disk. Onyx reads and writes them. Nothing more.

**Core principles:**
- P1. **Files are the source of truth.** No proprietary formats, no hidden databases. Everything is `.md` on disk with standard YAML frontmatter.
- P2. **Lightweight by default.** Every feature must justify its memory and complexity cost.
- P3. **Works with existing notes.** Must be fully compatible with a Zettelkasten that already uses wikilinks, frontmatter, and folder structure.
- P4. **Opinionated over configurable.** Build the right thing rather than every possible thing.

---

## 2. Tech Stack

### Frontend
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | **Tauri 2** | WebKit-based, ~10MB bundle, native OS integration, no Chromium |
| UI Framework | **React 18 + TypeScript** | Familiar, large ecosystem, good CodeMirror integration |
| Editor | **CodeMirror 6** | Best-in-class extensibility, lightweight, native markdown support, active development |
| State | **Zustand** (UI state) + **Rust backend** (file index, metadata) | Split: ephemeral UI state in JS, persistent data in Rust |
| Styling | **Plain CSS** (custom properties) | No framework overhead, full control, CSS variables for theming |
| Build | **Vite** | Fast HMR, good Tauri integration |

### Backend (Rust)
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Index/Cache | **SQLite** (via rusqlite) | Fast queries for backlinks/tags/properties, persisted across sessions, negligible memory |
| File watching | **notify** crate | Cross-platform file system events |
| YAML parsing | **serde_yaml_ng** | Parse frontmatter on the Rust side for indexing. ⚠️ `serde_yaml` is deprecated, `serde_yml` has a security advisory |
| Markdown parsing | **pulldown-cmark** | Fast link/tag extraction for indexing (not rendering — CM6 handles that). Has native `[[wikilink]]` support |
| Templates | **minijinja** | `{{ var }}` syntax for periodic note templates. 10x faster than handlebars/tera |
| MCP server | **rmcp + axum** | Official Rust MCP SDK with streamable HTTP transport. Axum runs on Tauri's tokio runtime |
| Fuzzy search | **nucleo-matcher** | From Helix editor, ~6x faster than alternatives. For quick open (Cmd+O) |
| File utilities | **ignore + trash** | `ignore` for .gitignore-style filtering (from ripgrep). `trash` for OS-native trash |
| CPU parallelism | **rayon** | Work-stealing thread pool for background indexing. Tokio for async I/O, rayon for CPU-bound |

### Why split state between JS and Rust?

MM keeps all state in Zustand + localStorage. This causes problems:
- Multi-window state sync via localStorage is fragile (the save dialog bug)
- No background processing (indexing, file watching) without blocking the UI
- File metadata queries (backlinks, tag search) are slow in JS at scale

**Onyx's model:** Rust owns the *data layer* (file index, metadata, file operations). React owns the *view layer* (which tabs are open, cursor position, sidebar state). They communicate via Tauri's IPC commands.

```
                        ┌──────────────────┐
                        │  Claude Code     │
                        │  (terminal)      │
                        └────────┬─────────┘
                                 │ MCP (stdio/SSE)
                                 │
┌────────────────────────────────┼────────────────┐
│  Window (WebKit)               │                │
│  ┌─────────────┐  ┌───────────┴──────────────┐  │
│  │ Zustand     │  │ CodeMirror 6             │  │
│  │ - tabs      │  │ - document state         │  │
│  │ - sidebar   │  │ - cursor, selection      │  │
│  │ - UI prefs  │  │ - undo/redo              │  │
│  └──────┬──────┘  └──────────┬───────────────┘  │
│         │    Tauri IPC       │                  │
├─────────┼────────────────────┼──────────────────┤
│  Rust   │                    │                  │
│  ┌──────┴────────────────────┴───────────────┐  │
│  │ Core                                      │  │
│  │ - SQLite index (files, links, tags)       │  │
│  │ - File watcher (notify)                   │  │
│  │ - File I/O (read, write, move)            │  │
│  │ - Template engine                         │  │
│  │ - Object type registry                    │  │
│  │ - MCP server (exposes core to AI tools)   │  │
│  │ - State broadcaster (active file, cursor) │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

The Rust core has **two consumers**: the Onyx frontend (via Tauri IPC) and external AI tools like Claude Code (via MCP). Same data layer, same index, same file operations. The MCP server doesn't add AI to Onyx — it makes Onyx's knowledge available to AI that lives elsewhere.

---

## 3. Window Model

**Single window, multiple panes.** Not multiple independent windows.

### Why not multi-window?

MM's multi-window approach (tab tear-off, independent windows sharing state) introduces:
- State synchronization complexity (save in one window triggers dialog in another)
- Duplicate file watchers and indexes
- Confusing UX (which window "owns" a file?)
- Significant engineering overhead for marginal benefit

### What instead

One window with flexible layout:
- **Sidebar** (left): file tree + registered directories
- **Editor area** (center): tabs + split panes (horizontal or vertical)
- **Context panel** (right, toggleable): backlinks, properties, outline
- **Status bar** (bottom): word count, file stats, mode indicator

Split panes give you side-by-side editing without any of the state sync issues. You can view a daily note next to a project note, or source next to preview.

If a genuine multi-window need emerges later, each window would get its own Tauri webview connecting to the shared Rust backend — but this is a v2 concern.

---

## 4. Data Model

### 4.1 Registered Directories

Instead of a single "vault", Onyx manages a list of **registered directories**. Each is a root in the file tree sidebar.

```rust
struct RegisteredDirectory {
    id: String,           // stable identifier
    path: PathBuf,        // absolute path on disk
    label: String,        // display name (e.g., "Zettelkasten", "Work")
    color: String,        // accent color for sidebar visual distinction (e.g., "#7c3aed")
    recursive: bool,      // index subdirectories
    position: u32,        // sort order in sidebar
}
```

**Behavior:**
- User adds directories manually (no auto-discovery)
- File tree lazy-loads on expand, with a refresh button per directory
- SQLite indexes all `.md` files in registered directories
- Ignore patterns: `.obsidian/`, `.git/`, `node_modules/`, configurable per directory

### 4.2 File Index (SQLite)

The index is a cache, not a source of truth. It can be rebuilt from disk at any time.

```sql
-- Every markdown file we know about
CREATE TABLE files (
    id          INTEGER PRIMARY KEY,
    path        TEXT UNIQUE NOT NULL,     -- absolute path
    dir_id      TEXT NOT NULL,            -- which registered directory
    title       TEXT,                     -- filename without .md
    modified_at INTEGER,                  -- file mtime
    indexed_at  INTEGER,                  -- last index time
    frontmatter TEXT                      -- raw YAML as JSON
);

-- Extracted links
CREATE TABLE links (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    target      TEXT NOT NULL,            -- raw link text e.g. "Some Note"
    target_id   INTEGER REFERENCES files(id) ON DELETE SET NULL,  -- resolved target
    line_number INTEGER,
    context     TEXT                      -- surrounding text snippet
);

-- Extracted tags
CREATE TABLE tags (
    id          INTEGER PRIMARY KEY,
    file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    tag         TEXT NOT NULL             -- without #, e.g. "book"
);

-- Object type definitions (user-configured)
CREATE TABLE object_types (
    id          INTEGER PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,     -- e.g. "Person", "Book"
    properties  TEXT NOT NULL             -- JSON array of property definitions
);

-- Bookmarks / starred notes
CREATE TABLE bookmarks (
    id          INTEGER PRIMARY KEY,
    file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    label       TEXT,
    position    INTEGER                   -- sort order
);
```

-- Indexes for query performance
CREATE INDEX idx_files_dir ON files(dir_id);
CREATE INDEX idx_files_title ON files(title);
CREATE INDEX idx_links_target ON links(target);
CREATE INDEX idx_links_target_id ON links(target_id);
CREATE INDEX idx_links_source ON links(source_id);
CREATE INDEX idx_tags_tag ON tags(tag);
CREATE INDEX idx_tags_file ON tags(file_id);
CREATE INDEX idx_bookmarks_file ON bookmarks(file_id);
```

**Frontmatter property queries:** For typed object queries like "all notes where `status = reading`", the `frontmatter` JSON column is queried via SQLite's `json_extract()`. For frequently queried properties, a denormalized `file_properties` table can be added later if `json_extract` becomes a bottleneck — but at <50k files it won't be.

**Indexing strategy:**
- On startup: check `modified_at` vs file mtime, re-index changed files only
- File watcher: re-index on change events (debounced 3s — longer than save debounce to avoid re-indexing mid-typing)
- Manual refresh button for full re-index
- Index only extracts: links, tags, frontmatter. It does NOT store file content.

### 4.3 Wikilink Resolution

When resolving `[[Some Note]]`:

1. **Same directory tree first** — search within the same registered directory
2. **Exact filename match** — `Some Note.md` anywhere in that tree
3. **If ambiguous** — prefer shortest path (closest to root)
4. **Cross-directory fallback** — only if no match in same tree
5. **Unresolved** — display as broken link (visually distinct), still clickable to create

**Broken link creation flow:** Click a broken `[[link]]` → immediately create an empty note with that title in the same directory as the current note. No location prompt — same-directory default matches Obsidian behavior and keeps the flow instant. The new note opens in the current tab.

This matches your existing Zettelkasten usage where links are intra-vault.

### 4.4 Typed Objects

Object types are defined globally in Onyx's config (stored in `~/.onyx/object-types.json`):

```json
[
  {
    "name": "Person",
    "properties": [
      { "key": "Full Name", "type": "text", "required": true },
      { "key": "Birthday", "type": "date" },
      { "key": "Email", "type": "text" },
      { "key": "Tags", "type": "tags" }
    ]
  },
  {
    "name": "Book",
    "properties": [
      { "key": "Author", "type": "text", "required": true },
      { "key": "Status", "type": "select", "options": ["reading", "finished", "dropped"] },
      { "key": "Rating", "type": "number", "min": 1, "max": 5 },
      { "key": "Finished", "type": "date" }
    ]
  }
]
```

**How it works:**
- A note's type is declared in frontmatter: `type: person`
- When you create/edit a note with a type, Onyx shows the property editor with the defined fields
- Properties are stored as standard YAML frontmatter (fully compatible with Obsidian/any editor)
- Notes without a `type` field are plain notes — no schema enforced
- Property types: `text`, `date`, `number`, `select`, `multiselect`, `tags`, `checkbox`, `link` (wikilink)

**What this looks like on disk:**
```yaml
---
type: person
Full Name: Alice Chen
Birthday: 1990-05-15
Email: alice@example.com
Tags: [collaborator, design]
---
```

Fully portable. Any markdown editor can read it. Onyx just gives you a nice UI for editing these properties and querying by type.

### 4.5 Blocks

A block is a section of a note, separated by `***` (asterisk horizontal rule). A note without separators is one block.

`***` is used instead of `---` to avoid ambiguity with YAML frontmatter delimiters. Both are valid markdown horizontal rules, but `***` has zero parsing overlap with frontmatter.

**Parsing rule:** The first `---` at line 1 opens frontmatter. The next `---` closes it. All subsequent content is note body, where `***` denotes block boundaries. `---` in the body is treated as a regular horizontal rule with no block semantics.

```rust
struct Block {
    index: usize,          // position in the note (0-based)
    content: String,       // raw markdown content
    line_start: usize,     // line number in the file
    line_end: usize,
}
```

**Block operations (available via right-click or keyboard shortcut):**
- Copy block to clipboard (as markdown)
- Copy block as wikilink reference (with block ID anchor)
- Move block up/down
- Delete block
- Create new note from block (extract + link back)

Block indexing explicitly excludes the frontmatter region. Block 0 is always the first content block after frontmatter.

Blocks are a UI concept, not a file format change. The file is still standard markdown with `***` separators.

---

## 5. Periodic Notes

Matches the existing Zettelkasten setup exactly.

### Configuration (stored in `~/.onyx/periodic-notes.json`)

```json
{
  "daily": {
    "enabled": true,
    "directory": "Calendar",
    "format": "YYYY/YYYY-MM/YYYY-MM-DD",
    "template": "Meta/Templates/Daily.md"
  },
  "weekly": {
    "enabled": true,
    "directory": "Calendar",
    "format": "YYYY/Weeklies/YYYY-[W]WW",
    "template": "Meta/Templates/Weekly.md"
  },
  "monthly": {
    "enabled": true,
    "directory": "Calendar",
    "format": "YYYY/Monthlies/YYYY-MM",
    "template": "Meta/Templates/Monthly.md"
  }
}
```

- `directory` is relative to a registered directory (user picks which one)
- `format` uses moment.js-compatible date tokens
- Folders are created automatically if they don't exist
- "Open today's note" command creates from template if it doesn't exist, opens if it does
- Calendar widget in the context panel for quick date jumping (see Section 7)

### Template Engine

Onyx uses its own template syntax (simpler than Templater, but covering the common cases):

```
{{date}}              → 2026-03-08
{{date:YYYY}}         → 2026
{{date:dddd}}         → Sunday
{{title}}             → filename without extension
{{time}}              → 14:30
{{yesterday}}         → [[2026-03-07]]
{{tomorrow}}          → [[2026-03-09]]
{{last_year}}         → [[2025-03-08]]
{{cursor}}            → place cursor here after creation
```

For the existing Templater `tp.` syntax in your templates: Onyx won't execute it (that would mean shipping a JS runtime in templates). Instead, there's a one-time migration: convert `tp.` syntax to Onyx's `{{}}` syntax. Or keep both template sets — Obsidian reads its Templater templates, Onyx reads its own.

---

## 6. Editor Architecture

### 6.1 CodeMirror 6 Extensions

The editor is CodeMirror 6 with custom extensions layered on:

| Extension | File | Status | Purpose |
|-----------|------|--------|---------|
| **Wikilink syntax** | `wikilinks.ts` | Done | Highlight `[[links]]`, click/Cmd+click follow, autocomplete from file index |
| **Tag syntax** | `tags.ts` | Done | Highlight `#tags`, viewport-aware, autocomplete from tag index |
| **Frontmatter** | `frontmatter.ts` | Done | YAML block detection, fold by default, syntax highlight, fold command |
| **Live preview** | `livePreview.ts` | Done | Viewport-aware inline rendering (headings, bold/italic, checkboxes, wikilinks, strikethrough, highlight) |
| **Formatting** | `formatting.ts` | Done | Cmd+B bold (`**`), Cmd+I italic (`_`), Cmd+Shift+C code, multi-cursor safe |
| **Symbol wrap** | `symbolWrap.ts` | Done | Wrap selection with `()`, `[]`, `{}`, `` ` ``, `""`, `''`, `_`, `*`, `=`, `~` on type |
| **Outliner** | `outliner.ts` | Done | Tab/Shift-Tab indent/outdent, Option+Up/Down move items, Enter/Backspace |
| **URL paste** | `urlPaste.ts` | Done | When pasting a URL with text selected, create `[text](url)` |
| **Autocomplete** | `autocomplete.ts` | Done | Wikilink (`[[`) + tag (`#`) autocomplete |
| **Linting** | — | Planned | Markdown lint rules, autofix on save |
| **Block awareness** | — | Planned (Phase 8) | Detect `***` separators, enable block operations |
| **Table editing** | — | Planned (Phase 8) | Tab/Enter navigation in tables, auto-alignment |
| **Natural language dates** | — | Planned (Phase 10) | `@today`, `@tomorrow`, `@next tuesday` → date links |
| **Embed preview** | — | Planned | Render `![[note]]` embeds inline (read-only preview) |

### 6.2 Editor Modes

Two modes, toggled with `Cmd+/`. Per-tab, persisted in session. Default: **Preview**.

1. **Preview** (default): Markdown is rendered inline via CM6 decorations. The "focus line" (cursor's line) shows raw markdown; all other lines render inline. Similar to Obsidian's live preview.
2. **Source**: Raw markdown with syntax highlighting. No inline rendering.

No separate "reading" mode. Preview serves that purpose.

**Implementation:** `StateField<boolean>` in CM6 controls preview mode. `ViewPlugin` builds decorations only when active. Zustand is the source of truth; CM6 field is a sync target. StatusBar shows clickable mode indicator.

### 6.3 Formatting

Available via:
- Keyboard shortcuts: `Cmd+B` bold (`**`), `Cmd+I` italic (`_`), `Cmd+Shift+C` inline code
- Symbol wrap: typing `(`, `[`, `{`, `` ` ``, `"`, `'`, `_`, `*`, `=`, `~` with text selected wraps it
- Command palette
- Slash commands (`/h1`, `/code`, `/table`, `/divider`) — planned

No floating toolbar — it adds visual noise. Keyboard-first.

### 6.4 Linting

Configurable markdown rules (carried over from MM's approach but refined):

| Rule | Default |
|------|---------|
| Heading style | ATX (`#`) only |
| List marker | Consistent within file |
| No duplicate headings | Warning |
| Trailing whitespace | Auto-fix |
| Final newline | Enforce |
| Frontmatter validity | Error on malformed YAML |

Auto-fix on save (configurable). Lint status in status bar. No separate lint panel — issues shown inline in the editor as underlines with hover details.

---

## 7. UI Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  ● ● ●                     (drag region)                         │
├────────────┬─────────────────────────────────────┬───────────────┤
│            │  [Daily.md] [Alice.md ●] [+]        │  Jun 2025     │
│  SIDEBAR   ├─────────────────────────────────────┤  < TODAY >    │
│            │                                     │  M T W T F S S│
│  ▾ Notes   │  Alice Chen            (inline H1)  │  . . . . . 1 2│
│    ▾ Cal   │                                     │  3 4 5 6 ⑦ 8 9│
│      2025/ │  ---                                │  ...          │
│    ▸ Ideas │  Full Name: Alice Chen              │               │
│    ▸ Peop  │  ---                                │  Backlinks    │
│    ▸ Read  │  # Log                              │  ─────────    │
│            │  - Thinking in Systems...           │  2025-06-10   │
│  ▾ Research│                                     │    "Call with │
│    ▸ docs  │  ---                                │     Alice..." │
│            │                                     │               │
│  ────────  │  Falcon                             │  Properties   │
│  ☆ Starred │  Open space...                      │  ─────────    │
│  - Daily   │                                     │  Type: Person │
│  - Alice   │                                     │  Full Name:   │
│            │                                     │  [Alice C.  ] │
│            │                                     │               │
│            │                                     │  Outline      │
│            │                                     │  ─────────    │
│            │                                     │  Log          │
├────────────┴─────────────────────────────────────┴───────────────┤
│  Ln 12, Col 4  │  218 words  │  Preview  │  ✓  │  path/Alice.md│
└──────────────────────────────────────────────────────────────────┘
```

**Key layout decisions:**
- Sidebar and context panel span full window height (top to bottom)
- Tab bar is scoped to the editor column, not the full window width
- Inline title (editable H1) sits between tab bar and editor content
- Titlebar is a minimal drag region with traffic lights only

### Sidebar (left, toggle with `Cmd+Option+[`)

- **Directory trees**: Each registered directory is a collapsible root node
  - Lazy-loaded on expand
  - Refresh button per directory
  - Right-click: new note, new folder, rename, delete, reveal in Finder
  - Sort: alphabetical (default), custom drag-to-reorder, by modified date
  - Visual indicators: file icons, unresolved link count badges
  - Each registered directory has a user-assignable **color accent** (3px left border or subtle background tint) for quick visual scanning — no need to read labels to distinguish directories
- **Bookmarks section** (pinned at sidebar bottom, doesn't scroll with tree): Starred/pinned notes for quick access. Always visible regardless of how deep the directory tree is scrolled.

### Context Panel (right, toggle with `Cmd+Option+]`)

- **Calendar widget** (top, always visible): Month view matching Obsidian's layout — current month with week numbers, today highlighted. Click any date to open/create the daily note for that date (uses periodic notes config for path/template). `< TODAY >` navigation. Visual indicators: dot for dates with daily notes, different marker for weekly/monthly notes. Weeks with a weekly note have a subtle highlight on the week number. Note creation must feel instant (<100ms perceived) — template engine runs in Rust, file write is <1ms, frontend receives the path and opens it. No loading spinner, no toast.
- **Backlinks, Properties, Outline** — collapsible accordion sections below the calendar. Smart defaults: if the active note has a `type` in frontmatter, Properties expands first. Otherwise, Backlinks expands first. Outline is collapsed by default. User can manually expand/collapse any section and the state is remembered per-session.

### Tab Bar

- Tabs for open files
- Modified indicator (dot)
- Cmd+click to open in split pane instead of replacing current tab
- Drag to reorder
- Middle-click to close
- No tab tear-off (single window model)

**Per-tab navigation stack:** Each tab maintains its own back/forward history, like a browser tab. Following a link (`Cmd+Enter`) in a tab pushes to that tab's history. `Cmd+[` / `Cmd+]` navigates that tab's stack. Opening a link in a new tab (`Cmd+click`) starts a fresh stack.

### Split Panes

- `Cmd+click` on a link or file opens it in a horizontal split (side-by-side) — this is the default and only split direction
- Draggable divider between panes
- Max 2 panes — keeps it simple, covers the primary use case (reference note + working note)
- Each pane has its own tab bar and navigation stack
- `Cmd+W` closes the active pane's tab; if it's the last tab in a pane, the pane collapses

### Native Menu Bar

Every user-facing action must be accessible from the macOS menu bar, even if it also has a button or keyboard shortcut. The menu bar is the canonical registry of all actions.

| Menu | Items |
|------|-------|
| **File** | New Note, New Note from Template, Open (Quick Open), Add Folder…, Close Tab, Close All Tabs, Save, Save All |
| **Edit** | Undo, Redo, Cut, Copy, Paste, Select All, Find, Find & Replace, Find in Files |
| **View** | Toggle Sidebar, Toggle Context Panel, Toggle Source/Preview, Command Palette, Zoom In/Out/Reset |
| **Go** | Back, Forward, Today's Daily Note, Go to Line |
| **Format** | Bold, Italic, Code, Heading 1-6, Blockquote, Bullet List, Numbered List, Task List, Insert Link, Insert Wikilink, Horizontal Rule |
| **Window** | Minimize, Zoom, Split Pane |
| **Help** | About Onyx, Keyboard Shortcuts Reference |

**Implementation:** Use Tauri 2's `Menu` + `MenuItem` API (Rust-side `tauri::menu`). Each menu item maps to a command ID that the frontend handles via `app.on_menu_event()`. Custom accelerators mirror the keyboard shortcuts table in §11.

### Status Bar

- Cursor position (Ln/Col)
- Word count (+ character count on hover)
- Editor mode toggle (click to switch)
- Lint status
- File path (click to copy)

---

## 8. File Operations

### Owned by Rust

All file I/O goes through the Rust backend. The frontend never reads or writes files directly.

```rust
// Tauri commands exposed to the frontend
#[tauri::command]
fn read_file(path: &str) -> Result<FileContent, FileError>;

#[tauri::command]
fn write_file(path: &str, content: &str) -> Result<(), FileError>;

#[tauri::command]
fn create_note(dir_id: &str, relative_path: &str, template: Option<&str>) -> Result<String, FileError>;

#[tauri::command]
fn move_file(from: &str, to: &str) -> Result<(), FileError>;

#[tauri::command]
fn delete_file(path: &str, trash: bool) -> Result<(), FileError>;  // trash=true → move to OS trash

#[tauri::command]
fn list_directory(path: &str) -> Result<Vec<DirEntry>, FileError>;

#[tauri::command]
fn search_files(query: &str) -> Result<Vec<SearchResult>, FileError>;

#[tauri::command]
fn get_backlinks(path: &str) -> Result<Vec<Backlink>, FileError>;

#[tauri::command]
fn get_tags() -> Result<Vec<TagCount>, FileError>;

#[tauri::command]
fn resolve_wikilink(link: &str, context_dir: &str) -> Result<Option<String>, FileError>;
```

**Why Rust owns file I/O:**
- Single source of truth for file state (no race between windows/tabs)
- Index stays in sync (write triggers re-index)
- File watcher events handled in one place
- Error handling is consistent

### Save behavior

Pseudo-immediate saving, like Obsidian. No explicit save action needed for existing files.

- **Auto-save**: debounced 500ms after last keystroke — effectively immediate. Not configurable to "off" (this is a design decision: your files are always saved).
- **Manual save** (`Cmd+S`): forces an immediate flush for the active tab. Useful for peace of mind, but auto-save handles it.
- **New untitled notes**: first save prompts for location (within a registered directory). After that, auto-save takes over.
- **External changes**: file watcher detects changes on disk. If the file is not actively being edited, reload silently. If the file IS being edited, merge only if the changed regions don't overlap with the user's edit region (line-level diffing). If regions overlap, reload the file and notify the user with a toast. No operational transforms — keep it simple.
- No "unsaved changes" dialogs on close — there are no unsaved changes.

### Delete behavior

- Delete always moves to OS trash (recoverable)
- Warns if other notes link to the file being deleted
- Updates index immediately

### File mutation coordination (`fileOps.ts`)

A file's identity (its path) is cached in multiple locations simultaneously:

| # | Location | Keyed by |
|---|----------|----------|
| 1 | Disk (filesystem) | Path |
| 2 | SQLite index (`files` table) | `path` column |
| 3 | Zustand tabs (`useAppStore`) | `tab.id` = `tab.path` |
| 4 | CM6 `editorStateCache` | Map key = tab ID (path) |
| 5 | CM6 `lastSavedContent` | Map key = tab ID (path) |
| 6 | CM6 `scrollCache` | Map key = tab ID (path) |
| 7 | Sidebar root entries | `loadDirectories()` result |
| 8 | Sidebar subtree children | `TreeNode` local `useState` |

Any file mutation (rename, move, delete) must update **all** of these atomically. A missed location causes stale references — clicking an old sidebar entry opens nothing, the tab shows the old name, or the editor serves cached content from a dead path.

**Solution:** A centralized `src/lib/fileOps.ts` module that owns the full mutation sequence for each operation. Components call `fileOps.rename()`, never `invoke("rename_file")` directly.

**Mutation sequence (rename example):**

```
1. Pre-flight     → validate (file exists, no name collision)
2. Disk op        → invoke("rename_file", { oldPath, newPath })
3. Index sync     → Rust command handles DB update internally
4. Tab sync       → useAppStore.getState().updateTabPath(oldId, newPath, newName)
5. Editor sync    → migrateEditorCache(oldPath, newPath)
6. Tree refresh   → useAppStore.getState().bumpFileTreeVersion()
```

**Required infrastructure:**

- `fileTreeVersion` counter in Zustand — sidebar subscribes and re-fetches children when bumped
- `migrateEditorCache(oldPath, newPath)` — moves entries in `editorStateCache`, `lastSavedContent`, `scrollCache` from old key to new key
- `clearEditorCache(path)` — removes all cached state for a deleted file
- Sidebar `TreeNode` watches `fileTreeVersion` and re-expands when it changes

**Tier 1 operations (must work before anything else):**

| Op | Disk | DB | Tabs | Editor | Tree |
|----|------|----|------|--------|------|
| Create note | `write_file` | auto (watcher→indexer) | `openFile` | seed cache | bump version |
| Rename file | `rename_file` | `db.rename_file` | `updateTabPath` | migrate cache | bump version |
| Delete file | `trash_file` | `db.delete_file` | `closeTab` | clear cache | bump version |
| Create folder | `create_folder` | — | — | — | bump version |
| Rename folder | `rename_file` | bulk path update | migrate all affected | migrate all affected | bump version |
| Delete folder | `trash_file` | bulk delete | close all affected | clear all affected | bump version |

---

## 9. Theming

### Approach

CSS custom properties controlled by a theme file. Users can create custom themes or use built-in ones.

```json
// ~/.onyx/themes/default-dark.json
{
  "name": "Onyx Dark",
  "type": "dark",
  "colors": {
    "bg-primary": "#1a1a2e",
    "bg-secondary": "#16213e",
    "bg-editor": "#0f0f1a",
    "text-primary": "#e0e0e0",
    "text-secondary": "#8888aa",
    "accent": "#7c3aed",
    "link": "#60a5fa",
    "border": "#2a2a4a"
  },
  "editor": {
    "font-family": "iA Writer Mono, monospace",
    "font-size": "16px",
    "line-height": "1.7",
    "content-width": "720px"
  }
}
```

**Built-in themes:** Light, Dark, and one warm-toned option.
**Custom themes:** Drop a JSON file in `~/.onyx/themes/`.
**Per-element styling:** Headings, code blocks, blockquotes, and links can have individual color/size overrides within a theme.

No separate theme settings UI — theme files are the config. Simple, portable, version-controllable.

---

## 10. MCP Server — AI Integration

Onyx runs a local MCP server so external AI tools (Claude Code, Claude Desktop, etc.) can interact with your notes without Onyx itself containing any AI logic.

### Architecture

The MCP server is a separate thread in the Rust backend, started on app launch. It exposes a subset of the core's capabilities as MCP tools.

**Transport:** Streamable HTTP on localhost (e.g., `http://localhost:19532/mcp`). This is the right fit for a long-running GUI app — stdio would require Onyx to be launched as a subprocess by the MCP client, which is backwards. For Claude Code integration, configure it as a remote MCP server pointing to localhost. An optional `onyx-mcp` CLI wrapper can bridge to stdio for clients that require it.

### MCP Tools Exposed

**Reading & Navigation**
| Tool | Description |
|------|-------------|
| `onyx_get_active` | Returns the currently active file path, cursor position, and selected text |
| `onyx_read_note` | Read a note by path or title |
| `onyx_search` | Full-text search across all registered directories |
| `onyx_get_backlinks` | Get all notes linking to a given note, with context snippets |
| `onyx_get_tags` | List all tags, optionally filtered, with file counts |
| `onyx_resolve_link` | Resolve a wikilink to an absolute file path |
| `onyx_list_directory` | List notes in a directory |
| `onyx_get_properties` | Get frontmatter and inline fields for a note |
| `onyx_query_by_type` | Find all notes of a given object type (e.g., all "Person" notes) |

**Writing & Modification**
| Tool | Description |
|------|-------------|
| `onyx_write_note` | Write/overwrite a note by path |
| `onyx_insert_at_cursor` | Insert text at the current cursor position (snapshotted at confirmation time) |
| `onyx_insert_after_heading` | Insert text after a specific heading in a note (anchor-based, not line-based) |
| `onyx_append_to_note` | Append content to the end of a note |
| `onyx_update_frontmatter` | Set/update frontmatter properties on a note |
| `onyx_create_note` | Create a new note, optionally from a template |

**Vault Awareness**
| Tool | Description |
|------|-------------|
| `onyx_get_index_stats` | Number of notes, links, tags, types across all directories |
| `onyx_get_object_types` | List all defined object types and their property schemas |
| `onyx_get_periodic_config` | Get periodic notes configuration (paths, templates, formats) |

### State File (Companion)

Onyx also writes `~/.onyx/state.json` on meaningful state changes — file switch, selection change, window focus — debounced 1s (not on every keystroke/cursor move):

```json
{
  "activeFile": "/home/user/Notes/People/Alice.md",
  "cursorLine": 12,
  "cursorCol": 4,
  "selectedText": "",
  "activeDir": "/home/user/Notes",
  "timestamp": 1741520400
}
```

This is a lightweight fallback for tools that don't speak MCP — any script or CLI tool can read this file to know what Onyx is focused on.

### Claude Code Integration Example

With the MCP server running, a Claude Code session could:

```
> Read my current note and suggest connections to other notes in my vault

Claude reads onyx_get_active → gets /People/Alice.md
Claude reads onyx_read_note → gets the content
Claude calls onyx_search for key topics → finds related notes
Claude calls onyx_get_backlinks → sees existing connections
Claude responds with suggestions and can onyx_insert_at_cursor to add links
```

### Security

- MCP server only listens locally (localhost or Unix socket)
- Write operations require confirmation in Onyx (a toast notification: "Claude Code wants to insert text into Alice.md — Allow / Deny")
- Read operations are allowed without confirmation (the files are already on disk)
- MCP server can be disabled entirely in `config.json`

### Config

```json
// In ~/.onyx/config.json
{
  "mcp": {
    "enabled": true,
    "transport": "http",
    "port": 19532,
    "writeConfirmation": true,
    "stateFile": true
  }
}
```

---

## 11. Keyboard-First Design

### Global shortcuts

| Shortcut | Action | Status |
|----------|--------|--------|
| `Cmd+O` | Quick open (fuzzy file search across all registered dirs) | Done |
| `Cmd+N` | New note in current directory | Done |
| `Cmd+S` | Save current tab | Done |
| `Cmd+W` | Close current tab | Done |
| `Cmd+Option+[` | Toggle sidebar (left) | Done |
| `Cmd+Option+]` | Toggle context panel (right) | Done |
| `Cmd+P` | Command palette | Done |
| `Cmd+/` | Toggle source / live preview | Done |
| `Cmd+Shift+D` | Open today's daily note | Done |
| `Cmd+F` | Find in current file | Done |
| `Cmd+Enter` | Follow link under cursor | Done |
| `Cmd+[` / `Cmd+]` | Navigate back / forward (per-tab history) | Done |
| Mouse 3/4 | Navigate back / forward (per-tab history) | Done |
| `Cmd+B` | Bold (`**selection**`) | Done |
| `Cmd+I` | Italic (`_selection_`) | Done |
| `Cmd+Shift+C` | Inline code (`` `selection` ``) | Done |
| `Option+Up/Down` | Move list item up/down (macOS) | Done |
| `Tab` / `Shift+Tab` | Indent/outdent list item | Done |
| `Cmd+Shift+F` | Search across all files | Planned |
| `Cmd+Shift+N` | New note from template | Planned |
| `Cmd+K` | Insert wikilink | Done |

### Click behavior

| Action | Behavior |
|--------|----------|
| Click | Replace current tab |
| Cmd+click | Open in new tab |

This applies uniformly to: sidebar files, wikilinks (preview + source), calendar dates, calendar week numbers, backlinks, recent docs, bookmarks, and Quick Open (Enter / Cmd+Enter).

### Command Palette (`Cmd+P`)

The primary discovery and execution surface. Every action in Onyx is a command.

- Fuzzy search over all available commands
- Recent commands shown first
- Commands are contextual (block operations only appear when cursor is in a block)
- Extensible: periodic note creation, template insertion, theme switching — all commands

### Custom Keybindings

Stored in `~/.onyx/keybindings.json`:

```json
[
  { "key": "Cmd+Shift+T", "command": "periodic.openToday" },
  { "key": "Cmd+Alt+B", "command": "block.copyAsMarkdown" }
]
```

Override any default binding. Conflicts are warned but allowed (last wins).

---

## 12. Configuration

All config lives in `~/.onyx/`:

```
~/.onyx/
├── config.json              # General settings
├── directories.json         # Registered directories
├── object-types.json        # Typed object definitions
├── periodic-notes.json      # Periodic notes config
├── keybindings.json         # Custom keybindings
├── themes/
│   ├── default-dark.json
│   ├── default-light.json
│   └── custom-theme.json
└── cache/
    └── index.db             # SQLite index (rebuildable)
```

`config.json` covers:
```json
{
  "editor": {
    "mode": "live-preview",
    "autoSave": true,
    "autoSaveDelay": 2000,
    "tabSize": 4,
    "lineNumbers": false,
    "autoPairs": true,
    "spellcheck": true
  },
  "linting": {
    "enabled": true,
    "fixOnSave": true,
    "rules": { }
  },
  "sidebar": {
    "visible": true,
    "width": 260,
    "showCalendar": true
  },
  "contextPanel": {
    "visible": true,
    "width": 300,
    "sections": ["calendar", "backlinks", "properties", "outline"]
  },
  "files": {
    "ignorePatterns": [".obsidian", ".git", "node_modules"],
    "defaultNoteLocation": "Inbox"
  }
}
```

Settings are edited either via the settings UI or by editing the JSON directly. Both are supported.

---

## 13. Feature Tiers

### Tier 0 — Foundation (MVP)

The minimum to replace Obsidian for daily use.

| Feature | Description |
|---------|-------------|
| File tree sidebar | Multi-directory, lazy-load, refresh, create/rename/delete |
| Markdown editor | CodeMirror 6, live preview + source mode |
| Wikilinks | `[[link]]` syntax, resolution, click to navigate |
| Backlinks panel | Show all notes linking to current note |
| Frontmatter | YAML parsing, display, basic editing |
| Tags | `#tag` extraction, index, display |
| Tabs | Open multiple files, modified indicator, close |
| Quick open | `Cmd+O` fuzzy search across all indexed files |
| Save | Auto-save + manual, conflict detection |
| Status bar | Word count, cursor position, mode |
| Theming | Light + dark built-in themes |
| Bookmarks | Star/unstar notes, bookmarks section in sidebar |
| MCP server | Expose core operations to external AI tools (Claude Code) |
| State file | Write active file/cursor/selection to `~/.onyx/state.json` |

### Tier 1 — Daily Driver

What makes it enjoyable enough to stay in.

| Feature | Description |
|---------|-------------|
| Periodic notes | Daily/weekly/monthly with templates and calendar widget |
| Template engine | `{{variable}}` syntax, cursor placement |
| Typed objects | Object type definitions, property editor in context panel |
| Block operations | `***` separation, copy block, move block, extract to note |
| Outliner mode | Tab/Shift-Tab indent, move list items, fold |
| Table editing | Tab navigation, auto-alignment, add/remove rows/cols |
| Split panes | Open two files side by side |
| Command palette | `Cmd+P` with fuzzy search over all commands |
| Custom sort | Drag-to-reorder files in sidebar |
| URL paste | Paste URL onto selection → `[selection](url)` |
| Natural language dates | `@today` → `[[2026-03-08]]` |
| Linting | Inline warnings, auto-fix on save |

### Tier 2 — Power Features

Nice to have, build when the foundation is solid.

| Feature | Description |
|---------|-------------|
| Slash commands | `/h1`, `/table`, `/template`, `/divider` |
| Custom keybindings | Override any shortcut |
| File search | Full-text search across all files (`Cmd+Shift+F`) |
| Heatmap calendar | Activity visualization for daily notes |
| Tracker widgets | Inline charts from frontmatter data |
| Print / export | PDF export with theme-aware styling |
| Text extraction | OCR from images, text from PDFs |
| Advanced theming | Per-element styling, custom theme files |

### Tier 3 — Someday

| Feature | Description |
|---------|-------------|
| Canvas | Infinite canvas with note cards |
| Graph view | Visual note connection map |
| Dataview-like queries | Query notes by properties inline |
| Sync | Git-based or custom sync between devices |
| Mobile companion | Read-only web view or lightweight mobile app |

---

## 14. What NOT to Build

Explicit scoping to avoid feature creep:

- **No plugin system.** Features are built-in or they don't exist. Plugins are why Obsidian is heavy.
- **No WYSIWYG rich text.** It's a markdown editor. Live preview renders inline but the source is always markdown.
- **No cloud sync.** Local-first. Use iCloud Drive, Dropbox, Syncthing, or git externally.
- **No AI inside Onyx.** No chat panes, no API calls, no LLM features. Onyx exposes its data via MCP so *external* AI tools can be vault-aware — but Onyx itself has no network dependency.
- **No web clipper.** Use the browser, paste into Onyx.
- **No PDF viewer/annotator.** Out of scope. Use Preview.app or Zotero.
- **No calendar events.** It creates notes for dates, not calendar entries.
- **No Dataview query language in v1.** Typed objects + frontmatter search cover 80% of the use case. Full query language is Tier 3.

---

## 15. Migration Path from Obsidian

Onyx should work with an existing Zettelkasten with zero migration for core notes:

| Obsidian Feature | Onyx Compatibility |
|------------------|--------------------|
| `[[wikilinks]]` | Native support |
| `![[embeds]]` | Render inline (read-only preview) |
| `#tags` | Native support |
| YAML frontmatter | Native support |
| Folder structure | Registered directory = vault root |
| `---` separators | Migrate to `***` for Onyx block boundaries |
| Dataview `Key:: Value` inline fields | Not supported — migrate to YAML frontmatter (one-time conversion) |
| Templater `tp.` syntax | Not executed — use Onyx templates alongside |
| `.obsidian/` config | Ignored (in ignore patterns) |

**Day 1 workflow:** Register your `~/Documents/Zettelkasten` directory. All notes, links, tags, and frontmatter work immediately. Set up periodic notes config to match your existing paths. Start using Onyx.

---

## 16. Resolved Design Decisions

Decisions made during the design phase:

1. **Inline Dataview fields** (`Key:: Value`) — **YAML only.** Onyx standardizes on YAML frontmatter as the sole property source. Existing notes using `Key:: Value` syntax should be migrated to frontmatter (a one-time conversion script). This avoids the two-sources-of-truth problem and keeps the parser simple.
2. **Templater user functions** (`tp.user.week_summary()`) — **Skip.** Custom JS execution in templates is out of scope. Users can achieve similar automation via Claude Code skills operating on Onyx files externally.
3. **Canvas files** (`.canvas`) — **Read-only display.** Parse Obsidian's JSON canvas format and render a non-editable visual view. Enough to reference existing canvases without needing to switch apps.
4. **Embed rendering** (`![[note]]`) — **Full content inline.** Embeds render the complete content of the linked note within the current document, read-only. Recursive embeds are capped at 2 levels deep to prevent infinite loops.
5. **Spellcheck** — **OS-native.** WebKit provides macOS spellcheck for free. No custom implementation needed.
6. **File saving & conflict resolution** — **Pseudo-immediate save** (500ms debounce). External file changes are auto-merged when possible, reloaded with notification when not. No "unsaved changes" dialogs.

## 17. Additional Design Decisions

1. **Property display** — Properties are YAML frontmatter only. The context panel renders them as a structured property editor for typed notes. In the editor, frontmatter is folded by default with a subtle header showing the note type.
2. **Canvas editing** — Read-only in v1. Basic editing (move/add cards) is a Tier 3 goal, only if read-only proves useful enough to warrant investment.
3. **Search scope** — Ripgrep-style direct file search via Rust. No full-text index in SQLite. Simpler, no stale index risk, fast enough for vaults under 50k files. If performance becomes an issue, full-text indexing can be added later without changing the UX.
4. **Periodic note navigation** — Calendar widget in the context panel is the sole navigation mechanism. No prev/next buttons in the editor header — keeps the editor chrome minimal.
5. **Live preview architecture** — CM6 `ViewPlugin` + `StateField<boolean>`. Viewport-aware from day one. "Focus line" (cursor's line) always shows raw markdown; all other lines render inline. Decorations rebuilt on `docChanged || viewportChanged || selectionSet || mode toggle`. Pre-scan caches frontmatter end and code-block states per visible range.
6. **Inline title** — Editable `<input>` above the editor displaying the filename without `.md`. Renaming commits on blur/Enter. Strips file-unsafe characters (`/`, `\0`, `:`). Reads active tab from Zustand store directly (not React closure) to avoid stale-closure races during rename.
7. **Default editor mode** — Preview, not source. New tabs open in preview mode. Session restore toggles tabs saved as "source".
8. **Click semantics** — Click replaces current tab, Cmd+click opens in new tab. Uniform across all navigation surfaces (sidebar, wikilinks, calendar, backlinks, recent docs, bookmarks, Quick Open). Matches browser link behavior. Wikilinks in preview mode use `mousedown` (not `click`) to fire before CM6 moves cursor and removes focus-line decorations.
9. **Navigation history** — Per-tab back/forward stacks (50-entry cap). Mouse buttons 3/4 (back/forward) supported via `auxclick` handler. `Cmd+[`/`Cmd+]` keyboard shortcuts. `replaceActiveTab` preserves nav history from the replaced tab.
10. **Italic marker** — `_` (underscore), not `*` (asterisk). Avoids ambiguity with bold (`**`) and bold-italic (`***`).
11. **CM6 keymap priority** — Custom keymaps (`formattingKeymap`, `outlinerKeymap`) are registered in separate `keymap.of()` calls placed before `defaultKeymap` in the extensions array. This ensures they take priority over CM6's defaults and WebKit's text system.
12. **WKWebView keyboard constraints** — Tauri uses WebKit (not Chromium). Some shortcuts like `Cmd+Shift+Arrow` are consumed by the Cocoa text system before reaching JS. Outliner uses `Alt-ArrowUp/Down` on macOS via CM6's `mac` property on keybindings.

---

## 18. Known Technical Debt

See [`docs/DEBT.md`](DEBT.md) for the full consolidated debt tracker (resolved + open items).
