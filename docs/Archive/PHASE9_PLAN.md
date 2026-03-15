# Phase 9 — Tables

## Context

Phase 7.8 (Polish & Deferred) is complete. Phase 8 (Split Panes) deferred. Tables are the next priority.

**New dependency:** `@tgrosinger/md-advanced-tables` (MIT license) — a battle-tested, editor-agnostic table engine (~3,650 LOC excluding formula module). Handles parsing, formatting, cell navigation, structural edits, escaped pipes, code spans, wikilinks with pipes, CJK width, and minimal-diff application. Originally forked from `mte-kernel`. Zero Obsidian dependencies.

**Approach:** Three layers:
1. **CM6 adapter** (`tableAdapter.ts`) — implements the library's `ITextEditor` interface using CM6's `EditorView`
2. **Live preview widget** (`livePreview.ts`) — `Decoration.replace` with `TableWidget` for rendered HTML tables
3. **Keybinding extension** (`tableEditor.ts`) — thin keymap that delegates to the library's `TableEditor`

When cursor is inside a table in preview mode, the entire table reverts to raw markdown (block-level focus reveal). This matches the existing live preview pattern and is a deliberate v1 limitation — cell-by-cell WYSIWYG editing (the Zettlr approach with sub-EditorViews) is a possible future upgrade but out of scope.

---

## Phase 9a — Read-Only Table Rendering

**Goal:** Tables render as formatted HTML in live preview. Cursor inside shows raw markdown.

### Steps

**9a-1. Install dependency**

```bash
npm install @tgrosinger/md-advanced-tables
```

Pin version. No transitive deps needed for core table ops (`meaw` is the only dep — East Asian Width for CJK column alignment).

**9a-2. Create `src/extensions/tableAdapter.ts`** (~80-100 lines)

Implements `ITextEditor` from `md-advanced-tables`:

```typescript
import { ITextEditor, options, Point, Range } from "@tgrosinger/md-advanced-tables";
```

Key methods to implement:
- `getCursorPosition()` → `Point` (line, column from CM6 selection)
- `setCursorPosition(pos: Point)` → dispatch CM6 selection
- `setSelectionRange(range: Range)` → dispatch CM6 selection range
- `getLastRow()` → `state.doc.lines - 1`
- `acceptsTableEdit(row: number)` → check Lezer tree: return `false` if line is inside a fenced code block or frontmatter
- `getLine(row: number)` → `state.doc.line(row + 1).text` (library uses 0-indexed rows)
- `insertLine(row: number, line: string)` → dispatch insert
- `deleteLine(row: number)` → dispatch delete
- `replaceLines(startRow, endRow, lines)` → dispatch replace
- `transact(func)` → batch edits (CM6 handles this naturally since each operation builds a single transaction)

Also export a helper: `isInTable(state: EditorState): boolean` — walks Lezer syntax tree from cursor position looking for `Table` ancestor node.

**9a-3. Table widget in livePreview.ts** — `src/extensions/livePreview.ts`

Add `TableWidget extends WidgetType` that:
- Receives raw table text + parsed alignment info
- Renders `<table class="cm-preview-table">` with `<thead>`/`<tbody>`
- Respects column alignment (`text-align: left|center|right`)
- Renders cell text as **plain text** (no inline formatting in rendered cells — avoids building a parallel inline renderer)
- `eq()` compares a hash of the raw table text (O(1), not deep array comparison)
- `estimatedHeight` returns `(rowCount + 1) * 28` (approximate row height) — prevents scrollbar jitter for large tables
- `destroy()` cleans up if needed

Integration with `buildPreviewDecorations()`:

The existing builder uses `RangeSetBuilder` which requires **strictly ascending position order**. Table widgets are multi-line blocks. Strategy:

1. Before the line loop, walk the Lezer syntax tree (`syntaxTree(state)`) to find all `Table` nodes overlapping visible ranges
2. For each table not containing the cursor: collect `{ from, to, decoration }` into a `tableDecos` array
3. Collect covered line numbers into a `Set<number>` (skip set)
4. In the line loop: at each line, first check if any table decoration starts at or before this line and emit it at the correct position (maintaining ascending order). Skip lines in the skip set.

This ensures table widget decorations interleave correctly with surrounding line decorations (headings, checkboxes, etc.).

Cache: Store last-rendered table data keyed by `(node.from, docLength, tableTextHash)`. Avoids re-parsing on cursor moves when the table hasn't changed. (`state.doc.version` doesn't exist in CM6 — use doc length + content hash instead.)

**Important:** The table `Decoration.replace` is provided via the existing `livePreviewPlugin`'s direct `decorations` property. This is required — replace decorations spanning line breaks cannot be provided indirectly. The existing plugin already uses the direct approach so no change needed.

**9a-4. Table CSS** — `src/styles/layout.css` (unlayered, with other editor overrides)

```css
.cm-preview-table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
.cm-preview-table th,
.cm-preview-table td { border: 1px solid var(--border); padding: 4px 8px; }
.cm-preview-table th { background: var(--bg-secondary); font-weight: 600; }
.cm-preview-table tr:hover { background: var(--bg-secondary); }
```

**Files:** `tableAdapter.ts` (new), `livePreview.ts`, `layout.css`, `package.json`

**Verify:** Open a note with a GFM table. In preview mode, table renders as HTML. Click into the table area — raw markdown appears. Click away — table re-renders. Scroll quickly past multiple tables — no scrollbar jitter.

---

## Phase 9b — Tab/Enter Navigation + Auto-Format

**Goal:** Tab moves between cells, Enter moves to next row. Auto-formatting on every navigation (the library handles this).

### Steps

**9b-1. Create `src/extensions/tableEditor.ts`** (~60-80 lines)

Thin keymap extension that delegates to `md-advanced-tables`'s `TableEditor`:

```typescript
import { TableEditor, options } from "@tgrosinger/md-advanced-tables";
```

Exports `tableEditorExtension(view: EditorView): Extension[]` containing a keymap:

| Key | Library method | Behavior |
|-----|---------------|----------|
| `Tab` | `tableEditor.nextCell(opts)` | Next cell. At last cell → new row. Auto-formats. |
| `Shift+Tab` | `tableEditor.previousCell(opts)` | Previous cell. Auto-formats. |
| `Enter` | `tableEditor.nextRow(opts)` | Same column, next row. At last row → new row. Auto-formats. |
| `Escape` | `tableEditor.escape(opts)` | Move cursor below table. |

Each handler:
1. Check `isInTable(state)` — if not, return `false` (pass through to outliner/defaults)
2. Create `CM6TextEditor` adapter wrapping the current `view`
3. Create `TableEditor` with the adapter
4. Call the appropriate method
5. Return `true`

The library applies edits via the `ITextEditor` interface methods and handles:
- Cursor repositioning after format
- Smart cursor column memory across Enter presses
- Minimal-diff line replacement (Myers diff, bounded to distance 3) for clean undo history
- CJK-aware column width alignment via `meaw`

Format options: Use `FormatType.NORMAL` (column-width alignment) by default. Expose `FormatType.WEAK` (trim + 1-space pad) as a config option for non-monospace editor fonts.

**9b-2. Register in Editor.tsx** — `src/components/Editor.tsx`

In `buildExtensions()`, add `tableEditorExtension()` keymap **before** outliner:

```
editorModeKeymap,
keymap.of(formattingKeymap),
// Table keybindings — must precede outliner so Tab/Enter are
// handled by table navigation when cursor is inside a table.
// Order contract: editorMode → formatting → table → outliner → defaults
...tableEditorExtension(),
keymap.of(outlinerKeymap),
```

**Files:** `tableEditor.ts` (new), `Editor.tsx`

**Verify:** Create a table `| A | B |\n|---|---|\n| 1 | 2 |`. Press Tab — cursor moves to cell B, table auto-formats. Tab again → cell 1. Enter at last row → new row added. Escape → cursor below table. Cmd+Z undoes cleanly (library uses minimal-diff edits).

---

## Phase 9c — Structural Commands + Paste + Table Creation

**Goal:** Column/row operations via command palette, paste handling, insert-table command.

### Steps

**9c-1. Column/row commands** — `src/extensions/tableEditor.ts` + `src/App.tsx`

Wire library methods to command palette entries:

| Command ID | Library method | Palette label |
|-----------|---------------|---------------|
| `table:insertColumnRight` | `tableEditor.insertColumn(opts)` | Insert Column Right |
| `table:insertColumnLeft` | (move cursor left, then insert) | Insert Column Left |
| `table:deleteColumn` | `tableEditor.deleteColumn(opts)` | Delete Column |
| `table:insertRowBelow` | `tableEditor.insertRow(opts)` | Insert Row Below |
| `table:deleteRow` | `tableEditor.deleteRow(opts)` | Delete Row |
| `table:moveColumnRight` | `tableEditor.moveColumn(1, opts)` | Move Column Right |
| `table:moveColumnLeft` | `tableEditor.moveColumn(-1, opts)` | Move Column Left |
| `table:moveRowDown` | `tableEditor.moveRow(1, opts)` | Move Row Down |
| `table:moveRowUp` | `tableEditor.moveRow(-1, opts)` | Move Row Up |
| `table:alignLeft` | `tableEditor.alignColumn(Alignment.LEFT, opts)` | Align Column Left |
| `table:alignCenter` | `tableEditor.alignColumn(Alignment.CENTER, opts)` | Align Column Center |
| `table:alignRight` | `tableEditor.alignColumn(Alignment.RIGHT, opts)` | Align Column Right |
| `table:sortAsc` | `tableEditor.sortRows(SortOrder.Ascending, opts)` | Sort Column Ascending |
| `table:sortDesc` | `tableEditor.sortRows(SortOrder.Descending, opts)` | Sort Column Descending |
| `table:transpose` | `tableEditor.transpose(opts)` | Transpose Table |

All commands: check `isInTable(state)` first. Register in `App.tsx` command registry with `when: "table"` condition so they only appear in the palette when cursor is in a table.

**9c-2. Paste handling** — `src/extensions/tableEditor.ts`

CM6 `EditorView.domEventHandlers({ paste })`:

TSV detection:
- Fallback heuristic (primary path — most apps don't set the MIME type): require ≥2 columns AND ≥2 rows of tab-separated data
- Also check `clipboardData.types` for `text/tab-separated-values` MIME type (Excel on Mac sets this)
- Single tab in text (`word\tword`) does NOT trigger table creation

Behavior:
- If cursor is NOT in a table and clipboard is TSV:
  - Convert TSV to GFM pipe table markdown
  - Insert at cursor position
- If cursor IS inside a table and clipboard is TSV:
  - Let CM6 handle normal paste (inserts into current cell as text)
  - Expanding an existing table with pasted data is complex and deferred

**9c-3. Copy table as TSV** — `src/extensions/tableEditor.ts`

When cursor is inside a table and user copies (Cmd+C with no selection or full-table selection):
- Put both GFM markdown (`text/plain`) and TSV (`text/tab-separated-values`) on the clipboard
- Enables pasting into spreadsheets without pipe syntax

**9c-4. Insert table command** — `src/extensions/tableEditor.ts` + `src/App.tsx`

Command palette entry: "Insert Table"
- Inserts a 3×2 template: `| Header 1 | Header 2 | Header 3 |\n|----------|----------|----------|\n|          |          |          |`
- Cursor placed in first body cell
- Register in `App.tsx` command registry (always visible, not table-conditional)

**9c-5. Keyboard shortcuts**

Table-context-only bindings (in `tableEditor.ts` keymap):
- `Ctrl+Shift+Right` — insert column right (NOT `Cmd+Shift+Right` — that's "select word right" on macOS, consumed by Cocoa before reaching JS)
- `Ctrl+Shift+Down` — insert row below

**Files:** `tableEditor.ts`, `App.tsx`

**Verify:**
- Paste TSV data outside a table → creates GFM table
- Copy from inside a table → pastes as TSV in a spreadsheet
- Command palette "Insert Table" → template inserted
- Column/row insert/delete/move/sort via command palette
- `Ctrl+Shift+Right/Down` shortcuts work inside tables

---

## Implementation Order

1. **Phase 9a** — `npm install` + tableAdapter.ts + livePreview.ts table widget + CSS (~200 lines new code)
2. **Phase 9b** — tableEditor.ts keymap + Editor.tsx registration (~80 lines new code)
3. **Phase 9c** — command palette wiring + paste/copy + insert command (~150 lines new code)

**Total new code: ~430 lines** (vs ~700 from scratch). The library contributes ~3,650 tested lines of parsing/formatting/navigation logic.

Each phase is independently shippable — 9a gives read-only rendering, 9b adds editing UX, 9c completes the feature.

---

## Key Design Decisions

- **`md-advanced-tables` for parsing/formatting/navigation** — MIT licensed, battle-tested, handles edge cases (escaped pipes, code spans, wikilinks, CJK width, mismatched columns). Avoids building a custom parser that duplicates work and risks diverging from the library's formatting.
- **Widget replacement, not line decorations** — tables are multi-line blocks. `Decoration.replace` is the established pattern (HRs already use it). Replace decorations must be provided directly (not indirectly) since they span line breaks.
- **Keymap before outliner** — Tab/Enter inside tables must be handled before the outliner claims them. CM6 tries keymaps in registration order; first `true` return wins.
- **Block-level focus reveal** — entire table reverts to raw markdown when cursor is inside. This is a v1 limitation. Cell-by-cell WYSIWYG editing (Zettlr's sub-EditorView approach) is architecturally possible but adds ~3,000 lines of complexity. The block-reveal approach ships a functional table feature without that investment. Upgrade path: replace `Decoration.replace` with a block widget containing per-cell sub-editors, proxying edits to the main document via `syncAnnotation`.
- **Library handles auto-format on every navigation** — unlike the original plan's "format on exit" approach, the library formats on every Tab/Enter press. This is the expected behavior (matches Obsidian Advanced Tables). The library uses Myers diff (bounded to edit distance 3) to apply minimal line changes, keeping undo history clean.
- **No formula support (for now)** — the library includes a formula engine (~1,000 LOC + `ebnf` + `decimal.js` deps) but we don't install those deps or expose the feature. Can be enabled later without code changes.
- **`Ctrl+Shift+Arrow` not `Cmd+Shift+Arrow`** — macOS Cocoa text system consumes `Cmd+Shift+Arrow` before it reaches JavaScript (WKWebView limitation). `Ctrl+Shift` is available.

## Gotchas

- **Pipe in cell content:** Handled by the library's parser — recognizes `\|` escapes, code spans, and wikilink pipes.
- **Empty cells:** Handled — `||` produces empty cell, padding/trimming works correctly.
- **Single-column tables:** Valid. Navigation is just up/down.
- **Malformed tables:** Library's parser handles gracefully (auto-completes missing delimiter, pads mismatched columns). Widget falls back to raw markdown if parsing fails entirely.
- **Block-level reveal height shift:** Rendered HTML table is shorter than raw markdown. When cursor enters and raw markdown appears, content below shifts down. `estimatedHeight` on the widget mitigates scrollbar jitter. CM6 handles scroll preservation for `Decoration.replace` transitions, but verify.
- **Tab trapping:** Tab navigates cells instead of moving focus. Escape is the exit hatch. Standard convention (Excel, Google Sheets, Obsidian Advanced Tables).
- **Inline formatting in rendered cells:** `Decoration.replace` blocks other livePreview decorations for the table range. Cells render as plain text. If inline rendering is needed later, extract `addInlineDecorations` logic into a shared utility that produces DOM nodes — don't build a parallel renderer.
- **TSV paste false positives:** Most browsers only set `text/plain` on clipboard, not `text/tab-separated-values`. The heuristic (≥2 cols AND ≥2 rows) is the primary detection path. Single tab in text does not trigger.
- **Tables inside blockquotes / list items:** GFM tables inside `> ` prefixed lines or list items are valid markdown. Lezer may or may not produce `Table` nodes for these. Test during 9a — if Lezer doesn't recognize them, they'll show as raw markdown (acceptable degradation). The library's `acceptsTableEdit` check should return `false` for lines with `>` prefix to avoid corrupting the blockquote markers.
- **Pipes inside code spans (spec conflict):** GFM says `\|` escapes work inside backtick code spans in tables, but CommonMark says backslashes are literal in code spans. `pulldown-cmark` (Rust backend) has a known bug here. The library handles this correctly on the frontend. Minor rendering inconsistency possible between preview and export — cosmetic.
- **Auto-format cursor drift:** The library handles cursor repositioning after format internally via the `ITextEditor.setCursorPosition` / `setSelectionRange` callbacks. No manual offset recalculation needed.
- **Library's 0-indexed rows vs CM6's 1-indexed lines:** The `ITextEditor` adapter must translate: library `row N` = CM6 `doc.line(N + 1)`. Off-by-one bugs are the most likely adapter issue.
- **Copy with no selection:** Need to detect "cursor in table with no selection" vs "user selected specific text" to decide whether to put TSV on clipboard. Don't override normal copy behavior when the user has selected arbitrary text that happens to overlap a table.

## Verification (End-to-End)

1. Open a note with `| A | B |\n|---|---|\n| 1 | 2 |`
2. **9a:** In preview mode, see rendered HTML table with aligned columns. Click into it — raw markdown. Click away — re-renders. Large table (20+ rows) — no scrollbar jitter.
3. **9b:** Click into a cell. Tab → next cell, pipes auto-align. Enter at last row → new row. Escape → cursor below table. Cmd+Z undoes cleanly.
4. **9c:** Command palette → "Insert Table" → template. Paste TSV from spreadsheet outside table → GFM table. Copy table → paste in spreadsheet → tab-separated values. Column/row insert/delete/move/sort via palette.
