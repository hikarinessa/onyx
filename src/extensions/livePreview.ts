import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import {
  StateField,
  StateEffect,
  RangeSetBuilder,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { findTablesInRange } from "./tableAdapter";
import {
  readTable,
  type Options,
  optionsWithDefaults,
  FormatType,
  type Table,
} from "@tgrosinger/md-advanced-tables";

/**
 * Live Preview extension for Onyx.
 *
 * When active, hides markdown syntax on unfocused lines and renders
 * inline previews. The cursor's line always shows raw markdown.
 *
 * Elements: headings, bold/italic, checkboxes, wikilinks, tags
 */

// ── Effects & State ──

export const togglePreviewEffect = StateEffect.define<boolean>();

export const previewModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(togglePreviewEffect)) return e.value;
    }
    return value;
  },
});

// ── Widgets ──

class CheckboxWidget extends WidgetType {
  /** @param checked current check state @param bracketPos absolute doc position of `[` */
  constructor(readonly checked: boolean, readonly bracketPos: number) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-preview-checkbox";
    // Build aria-label from the text after the checkbox on this line
    const line = view.state.doc.lineAt(this.bracketPos);
    const labelText = line.text.slice(this.bracketPos - line.from + 4).trim();
    if (labelText) input.setAttribute("aria-label", labelText);
    input.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const replacement = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from: this.bracketPos, to: this.bracketPos + 3, insert: replacement },
      });
    });
    return input;
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.bracketPos === other.bracketPos;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class HRWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement("hr");
    hr.className = "cm-preview-hr";
    return hr;
  }

  eq(): boolean {
    return true;
  }
}

// ── Table Widget ──

const tableParseOpts: Options = optionsWithDefaults({
  formatType: FormatType.NORMAL,
});

class TableWidget extends WidgetType {
  private rowCount: number;

  constructor(
    private tableText: string,
    private parsedTable: Table,
  ) {
    super();
    this.rowCount = parsedTable.getHeight();
  }

  eq(other: TableWidget): boolean {
    return this.tableText === other.tableText;
  }

  get estimatedHeight(): number {
    return (this.rowCount + 1) * 28;
  }

  toDOM(): HTMLElement {
    const table = this.parsedTable;
    const rows = table.getRows();
    const delimRow = table.getDelimiterRow();

    // Parse alignments from delimiter row
    const alignments: (string | undefined)[] = [];
    if (delimRow) {
      for (const cell of delimRow.getCells()) {
        const a = cell.getAlignment();
        alignments.push(
          a === undefined ? undefined : (a as string),
        );
      }
    }

    const el = document.createElement("table");
    el.className = "cm-preview-table";
    el.style.borderCollapse = "collapse";
    el.style.margin = "0.5em 0";

    // Header (row 0)
    if (rows.length > 0) {
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      const headerCells = rows[0].getCells();
      for (let c = 0; c < headerCells.length; c++) {
        const th = document.createElement("th");
        th.textContent = headerCells[c].content;
        th.style.border = "1px solid var(--border-default)";
        th.style.padding = "4px 12px";
        th.style.fontWeight = "600";
        th.style.background = "var(--bg-elevated)";
        const align = alignments[c];
        if (align && align !== "none") th.style.textAlign = align;
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      el.appendChild(thead);
    }

    // Body (rows 2+, skip delimiter at row 1)
    if (rows.length > 2) {
      const tbody = document.createElement("tbody");
      for (let r = 2; r < rows.length; r++) {
        const tr = document.createElement("tr");
        const cells = rows[r].getCells();
        for (let c = 0; c < cells.length; c++) {
          const td = document.createElement("td");
          td.textContent = cells[c].content;
          td.style.border = "1px solid var(--border-default)";
          td.style.padding = "4px 12px";
          const align = alignments[c];
          if (align && align !== "none") td.style.textAlign = align;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      el.appendChild(tbody);
    }

    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Try to parse table text into a Table object using md-advanced-tables.
 * Returns null if unparseable.
 */
function tryParseTable(text: string): Table | null {
  try {
    const lines = text.split("\n");
    if (lines.length < 2) return null;
    const table = readTable(lines, tableParseOpts);
    // Verify it has a valid delimiter row
    if (!table.getDelimiterRow()) return null;
    return table;
  } catch {
    return null;
  }
}

// ── Patterns ──

const THEMATIC_BREAK_RE = /^[ ]{0,3}([-*_])[ ]*(?:\1[ ]*){2,}$/;
const HEADING_RE = /^(#{1,6})\s+/;
const BOLD_ITALIC_RE = /\*{3}(.+?)\*{3}/g;
const BOLD_ITALIC_UNDER_RE = /(?<![a-zA-Z0-9])_{3}(.+?)_{3}(?![a-zA-Z0-9])/g;
const BOLD_RE = /\*{2}(.+?)\*{2}/g;
const BOLD_UNDER_RE = /(?<![a-zA-Z0-9_])__([^_]+?)__(?![a-zA-Z0-9_])/g;
const ITALIC_STAR_RE = /(?<!\*)\*([^*]+)\*(?!\*)/g;
const ITALIC_UNDER_RE = /(?<![a-zA-Z0-9_])_([^_]+)_(?![a-zA-Z0-9_])/g;
const STRIKETHROUGH_RE = /~~(.+?)~~/g;
const HIGHLIGHT_RE = /==(.+?)==/g;
const CHECKBOX_RE = /^(\s*[-*+]\s)\[([ x])\]\s/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// ── Hoisted decoration objects (immutable, reused across calls) ──

const DECO_REPLACE = Decoration.replace({});
const DECO_BOLD = Decoration.mark({ class: "cm-preview-bold" });
const DECO_ITALIC = Decoration.mark({ class: "cm-preview-italic" });
const DECO_BOLD_ITALIC = Decoration.mark({ class: "cm-preview-bold cm-preview-italic" });
const DECO_STRIKETHROUGH = Decoration.mark({ class: "cm-preview-strikethrough" });
const DECO_HIGHLIGHT = Decoration.mark({ class: "cm-preview-highlight" });
const DECO_WIKILINK = Decoration.mark({ class: "cm-preview-wikilink" });
const DECO_CHECKED = Decoration.mark({ class: "cm-preview-checked" });

// ── Pre-scan cache ──

interface PreScanResult {
  fmEnd: number;
  /** Maps visible range start line → inCodeBlock state at that line */
  codeBlockStates: Map<number, boolean>;
}

function preScanDocument(view: EditorView): PreScanResult {
  const doc = view.state.doc;

  // Determine frontmatter end line
  let fmEnd = 0;
  if (doc.lines >= 2 && doc.line(1).text.trim() === "---") {
    for (let j = 2; j <= doc.lines; j++) {
      if (doc.line(j).text.trim() === "---") { fmEnd = j; break; }
    }
  }

  // Pre-scan code block state for each visible range start
  const codeBlockStates = new Map<number, boolean>();
  for (const { from } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    if (!codeBlockStates.has(startLine)) {
      let inCodeBlock = false;
      for (let j = 1; j < startLine; j++) {
        if (j <= fmEnd) continue;
        if (doc.line(j).text.trimStart().startsWith("```")) {
          inCodeBlock = !inCodeBlock;
        }
      }
      codeBlockStates.set(startLine, inCodeBlock);
    }
  }

  return { fmEnd, codeBlockStates };
}

// ── Decoration builder ──

/**
 * Detect which line numbers are covered by tables that should be rendered
 * as widgets (i.e. tables NOT containing the cursor).
 * Used by both the inline ViewPlugin (to skip those lines) and the
 * block-level StateField (to emit replace decorations).
 */
function detectTableRanges(
  view: EditorView,
  fmEnd: number,
): { skipLines: Set<number>; decos: { from: number; to: number; text: string; table: Table }[] } {
  const doc = view.state.doc;
  const cursorLine = doc.lineAt(view.state.selection.main.head).number;
  const skipLines = new Set<number>();
  const decos: { from: number; to: number; text: string; table: Table }[] = [];

  for (const { from, to } of view.visibleRanges) {
    const tables = findTablesInRange(view.state, from, to);
    for (const t of tables) {
      const tableStartLine = doc.lineAt(t.from).number;
      const tableEndLine = doc.lineAt(t.to).number;

      if (cursorLine >= tableStartLine && cursorLine <= tableEndLine) continue;
      if (fmEnd > 0 && tableStartLine <= fmEnd) continue;

      const rangeFrom = doc.line(tableStartLine).from;
      const rangeTo = doc.line(tableEndLine).to;
      const tableText = doc.sliceString(rangeFrom, rangeTo);
      const parsed = tryParseTable(tableText);
      if (!parsed) continue;

      for (let ln = tableStartLine; ln <= tableEndLine; ln++) {
        skipLines.add(ln);
      }
      decos.push({ from: rangeFrom, to: rangeTo, text: tableText, table: parsed });
    }
  }

  return { skipLines, decos };
}

function buildPreviewDecorations(view: EditorView, scan: PreScanResult, tableSkipLines: Set<number>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const { fmEnd, codeBlockStates } = scan;

  const cursorLine = doc.lineAt(view.state.selection.main.head).number;

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;

    let inCodeBlock = codeBlockStates.get(startLine) ?? false;

    for (let i = startLine; i <= endLine; i++) {
      const line = doc.line(i);

      // Skip lines covered by table widgets
      if (tableSkipLines.has(i)) continue;

      const text = line.text;

      // Skip frontmatter
      if (fmEnd > 0 && i <= fmEnd) continue;

      // Track code blocks (must run even on cursor line to keep state correct)
      if (text.trimStart().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        if (i === cursorLine) continue;
        continue;
      }
      if (inCodeBlock) continue;

      // Skip the focus line — show raw markdown there
      if (i === cursorLine) continue;

      // ── Thematic breaks (---, ***, ___) ──
      if (THEMATIC_BREAK_RE.test(text)) {
        builder.add(
          line.from,
          line.to,
          Decoration.replace({ widget: new HRWidget() })
        );
        continue;
      }

      // ── Headings ──
      const headingMatch = text.match(HEADING_RE);
      if (headingMatch) {
        const level = headingMatch[1].length;
        // Line decoration must come before range decorations at the same position
        builder.add(
          line.from,
          line.from,
          Decoration.line({ class: `cm-preview-heading cm-preview-h${level}` })
        );
        // Hide # markers
        const markerLen = headingMatch[0].length;
        builder.add(line.from, line.from + markerLen, DECO_REPLACE);
        // Process inline formatting on the text after the markers
        const headingContent = text.slice(markerLen);
        const contentLine = { from: line.from + markerLen, to: line.to };
        addInlineDecorations(builder, contentLine, headingContent);
        continue;
      }

      // ── Checkboxes ──
      const cbMatch = text.match(CHECKBOX_RE);
      if (cbMatch) {
        const checked = cbMatch[2] === "x";
        const bracketStart = line.from + cbMatch[1].length;
        // Replace [ ] or [x] with checkbox widget
        builder.add(
          bracketStart,
          bracketStart + 4, // [x] + trailing space
          Decoration.replace({
            widget: new CheckboxWidget(checked, bracketStart),
          })
        );
        if (checked) {
          builder.add(
            bracketStart + 4,
            line.to,
            DECO_CHECKED
          );
        }
        // Process inline decorations on text after the checkbox marker
        const afterCb = text.slice(cbMatch[0].length);
        if (afterCb.length > 0) {
          const cbContentLine = { from: line.from + cbMatch[0].length, to: line.to };
          addInlineDecorations(builder, cbContentLine, afterCb);
        }
        continue;
      }

      // ── Inline decorations ──
      addInlineDecorations(builder, line, text);
    }
  }

  return builder.finish();
}

/** Add inline decorations (bold, italic, wikilinks) to a line */
function addInlineDecorations(
  builder: RangeSetBuilder<Decoration>,
  line: { from: number; to: number },
  text: string,
): void {
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  // Track claimed text spans to prevent overlapping matches
  const claimed: { from: number; to: number }[] = [];

  function isClaimed(from: number, to: number): boolean {
    return claimed.some((c) => from < c.to && to > c.from);
  }

  let m: RegExpExecArray | null;

  /** Match a symmetric inline pattern, hide markers, apply decoration */
  function matchInline(re: RegExp, markerLen: number, deco: Decoration, skipClaimed = true) {
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (skipClaimed && isClaimed(from, to)) continue;
      ranges.push({ from, to: from + markerLen, deco: DECO_REPLACE });
      ranges.push({ from: from + markerLen, to: to - markerLen, deco });
      ranges.push({ from: to - markerLen, to, deco: DECO_REPLACE });
      claimed.push({ from, to });
    }
  }

  // Order matters: longer markers first to prevent partial matches
  matchInline(BOLD_ITALIC_RE, 3, DECO_BOLD_ITALIC, false);
  matchInline(BOLD_ITALIC_UNDER_RE, 3, DECO_BOLD_ITALIC, false);
  matchInline(BOLD_RE, 2, DECO_BOLD);
  matchInline(BOLD_UNDER_RE, 2, DECO_BOLD);
  matchInline(ITALIC_STAR_RE, 1, DECO_ITALIC);
  matchInline(ITALIC_UNDER_RE, 1, DECO_ITALIC);
  matchInline(STRIKETHROUGH_RE, 2, DECO_STRIKETHROUGH);
  matchInline(HIGHLIGHT_RE, 2, DECO_HIGHLIGHT);

  // Wikilinks
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    ranges.push({ from, to: from + 2, deco: DECO_REPLACE });
    if (m[2]) {
      const pipeIdx = m[0].indexOf("|");
      ranges.push({ from: from + 2, to: from + pipeIdx + 1, deco: DECO_REPLACE });
    }
    const displayFrom = m[2] ? from + m[0].indexOf("|") + 1 : from + 2;
    ranges.push({ from: displayFrom, to: to - 2, deco: DECO_WIKILINK });
    ranges.push({ from: to - 2, to, deco: DECO_REPLACE });
  }

  // Sort by position and add to builder
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const r of ranges) {
    if (r.from < r.to) {
      builder.add(r.from, r.to, r.deco);
    }
  }
}

// ── ViewPlugin ──

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    scan: PreScanResult;
    tableSkipLines: Set<number>;

    constructor(view: EditorView) {
      this.scan = preScanDocument(view);
      this.tableSkipLines = new Set();
      const active = view.state.field(previewModeField);
      if (active) {
        const td = detectTableRanges(view, this.scan.fmEnd);
        this.tableSkipLines = td.skipLines;
        this.decorations = buildPreviewDecorations(view, this.scan, td.skipLines);
      } else {
        this.decorations = Decoration.none;
      }
    }

    update(update: ViewUpdate) {
      const active = update.view.state.field(previewModeField);
      if (!active) {
        this.decorations = Decoration.none;
        this.tableSkipLines = new Set();
        return;
      }
      if (update.docChanged || update.viewportChanged) {
        this.scan = preScanDocument(update.view);
      }
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.startState.field(previewModeField) !== active
      ) {
        const td = detectTableRanges(update.view, this.scan.fmEnd);
        this.tableSkipLines = td.skipLines;
        this.decorations = buildPreviewDecorations(update.view, this.scan, td.skipLines);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// ── Table block decorations (separate StateField — required by CM6 for
//    replace decorations that span multiple lines) ──

/**
 * Block-level table decorations via StateField.
 * CM6 requires block replace decorations to come from a StateField
 * (not a ViewPlugin). We scan the full document syntax tree — acceptable
 * for note-sized files (<50K lines).
 */
function buildTableBlockDecos(state: EditorState): DecorationSet {
  if (!state.field(previewModeField)) return Decoration.none;

  const doc = state.doc;
  const cursorLine = doc.lineAt(state.selection.main.head).number;
  const tree = syntaxTree(state);

  // Determine frontmatter end
  let fmEnd = 0;
  if (doc.lines >= 2 && doc.line(1).text.trim() === "---") {
    for (let j = 2; j <= doc.lines; j++) {
      if (doc.line(j).text.trim() === "---") { fmEnd = j; break; }
    }
  }

  const builder = new RangeSetBuilder<Decoration>();

  tree.iterate({
    enter(node) {
      if (node.name !== "Table") return;

      const tableStartLine = doc.lineAt(node.from).number;
      const tableEndLine = doc.lineAt(node.to).number;

      // Skip if cursor is inside this table
      if (cursorLine >= tableStartLine && cursorLine <= tableEndLine) return false;
      // Skip tables inside frontmatter
      if (fmEnd > 0 && tableStartLine <= fmEnd) return false;

      const rangeFrom = doc.line(tableStartLine).from;
      const rangeTo = doc.line(tableEndLine).to;
      const tableText = doc.sliceString(rangeFrom, rangeTo);
      const parsed = tryParseTable(tableText);
      if (!parsed) return false;

      builder.add(
        rangeFrom,
        rangeTo,
        Decoration.replace({
          widget: new TableWidget(tableText, parsed),
          block: true,
        })
      );

      return false; // don't descend into table children
    },
  });

  return builder.finish();
}

const tableBlockField = StateField.define<DecorationSet>({
  create(state) {
    return buildTableBlockDecos(state);
  },
  update(decos, tr) {
    if (tr.docChanged || tr.selection !== tr.startState.selection || tr.effects.some(e => e.is(togglePreviewEffect))) {
      return buildTableBlockDecos(tr.state);
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Theme ──

const previewTheme = EditorView.theme({
  ".cm-preview-heading": {
    fontWeight: "600",
  },
  ".cm-preview-heading *": {
    color: "inherit !important",
  },
  ".cm-preview-h1": {
    fontSize: "var(--heading-1-size, 1.6em)",
    color: "var(--heading-1-color, inherit)",
    lineHeight: "1.3",
  },
  ".cm-preview-h2": {
    fontSize: "var(--heading-2-size, 1.3em)",
    color: "var(--heading-2-color, inherit)",
    lineHeight: "1.3",
  },
  ".cm-preview-h3": {
    fontSize: "var(--heading-3-size, 1.1em)",
    color: "var(--heading-3-color, inherit)",
    lineHeight: "1.4",
  },
  ".cm-preview-h4": {
    fontSize: "var(--heading-4-size, 1.05em)",
    color: "var(--heading-4-color, inherit)",
  },
  ".cm-preview-h5": {
    fontSize: "var(--heading-5-size, 1.0em)",
    color: "var(--heading-5-color, inherit)",
  },
  ".cm-preview-h6": {
    fontSize: "var(--heading-6-size, 0.9em)",
    color: "var(--heading-6-color, inherit)",
  },
  ".cm-preview-bold": {
    fontWeight: "700",
  },
  ".cm-preview-italic": {
    fontStyle: "italic",
  },
  ".cm-preview-strikethrough": {
    textDecoration: "line-through",
    opacity: "0.7",
  },
  ".cm-preview-hr": {
    border: "none",
    borderTop: "1px solid var(--border-subtle)",
    margin: "0.15em 0",
  },
  ".cm-preview-highlight": {
    background: "rgba(255, 204, 0, 0.3)",
    borderRadius: "2px",
    padding: "1px 0",
  },
  ".cm-preview-checkbox": {
    verticalAlign: "middle",
    marginRight: "4px",
    cursor: "pointer",
    accentColor: "var(--accent)",
  },
  ".cm-preview-checked": {
    textDecoration: "line-through",
    opacity: "0.6",
  },
  ".cm-preview-wikilink": {
    color: "var(--link-color)",
    cursor: "pointer",
    textDecoration: "var(--link-underline, underline)",
    textUnderlineOffset: "2px",
  },
  ".cm-preview-tag": {
    background: "var(--tag-bg)",
    color: "var(--tag-text)",
    borderRadius: "3px",
    padding: "1px 4px",
    fontSize: "0.9em",
  },
});

// ── Export ──

export function livePreviewExtension(): Extension[] {
  return [previewModeField, livePreviewPlugin, tableBlockField, previewTheme];
}
