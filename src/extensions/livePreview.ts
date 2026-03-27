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
import { syntaxTree, foldEffect, unfoldEffect, foldedRanges } from "@codemirror/language";
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

/** Read base line height (px) from CSS custom properties for widget estimatedHeight. */
function getBaseLineHeight(): number {
  const s = document.documentElement.style;
  const fontSize = parseFloat(s.getPropertyValue("--editor-font-size")) || 16;
  const lineHeight = parseFloat(s.getPropertyValue("--editor-line-height")) || 1.7;
  return fontSize * lineHeight;
}

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

// ── Callout fold state ──

/** Toggle a callout's collapsed state. Value is the doc position of the callout header line start. */
const toggleCalloutFold = StateEffect.define<number>();

/**
 * Tracks which callout headers are collapsed, by document position (line start).
 * Positions are remapped via mapPos on edits so they survive insertions/deletions.
 * `-` suffix callouts start collapsed; `+` and unmarked start expanded.
 */
const calloutFoldField = StateField.define<Set<number>>({
  create: () => new Set(),
  update(collapsed, tr) {
    let updated = collapsed;
    for (const e of tr.effects) {
      if (e.is(toggleCalloutFold)) {
        updated = new Set(updated);
        if (updated.has(e.value)) {
          updated.delete(e.value);
        } else {
          updated.add(e.value);
        }
      }
    }
    // Remap positions on doc changes
    if (tr.docChanged && updated.size > 0) {
      const remapped = new Set<number>();
      for (const pos of updated) {
        const newPos = tr.changes.mapPos(pos, 1);
        if (newPos < tr.newDoc.length) {
          remapped.add(newPos);
        }
      }
      return remapped;
    }
    return updated;
  },
});

// ── Widgets ──

// ── Callout / Admonition types ──

interface CalloutDef {
  icon: string;
  colorClass: string;
  defaultTitle: string;
}

const CALLOUT_TYPES: Record<string, CalloutDef> = {
  note: { icon: "pencil", colorClass: "callout-note", defaultTitle: "Note" },
  abstract: { icon: "clipboard-list", colorClass: "callout-abstract", defaultTitle: "Abstract" },
  summary: { icon: "clipboard-list", colorClass: "callout-abstract", defaultTitle: "Summary" },
  info: { icon: "info", colorClass: "callout-info", defaultTitle: "Info" },
  todo: { icon: "check-circle", colorClass: "callout-info", defaultTitle: "Todo" },
  tip: { icon: "flame", colorClass: "callout-tip", defaultTitle: "Tip" },
  hint: { icon: "lightbulb", colorClass: "callout-tip", defaultTitle: "Hint" },
  important: { icon: "flame", colorClass: "callout-tip", defaultTitle: "Important" },
  success: { icon: "check", colorClass: "callout-success", defaultTitle: "Success" },
  check: { icon: "check", colorClass: "callout-success", defaultTitle: "Check" },
  done: { icon: "check", colorClass: "callout-success", defaultTitle: "Done" },
  question: { icon: "help-circle", colorClass: "callout-question", defaultTitle: "Question" },
  faq: { icon: "help-circle", colorClass: "callout-question", defaultTitle: "FAQ" },
  help: { icon: "help-circle", colorClass: "callout-question", defaultTitle: "Help" },
  warning: { icon: "alert-triangle", colorClass: "callout-warning", defaultTitle: "Warning" },
  caution: { icon: "alert-triangle", colorClass: "callout-warning", defaultTitle: "Caution" },
  attention: { icon: "alert-triangle", colorClass: "callout-warning", defaultTitle: "Attention" },
  failure: { icon: "x", colorClass: "callout-failure", defaultTitle: "Failure" },
  fail: { icon: "x", colorClass: "callout-failure", defaultTitle: "Failure" },
  missing: { icon: "x", colorClass: "callout-failure", defaultTitle: "Missing" },
  danger: { icon: "zap", colorClass: "callout-danger", defaultTitle: "Danger" },
  error: { icon: "zap", colorClass: "callout-danger", defaultTitle: "Error" },
  bug: { icon: "bug", colorClass: "callout-danger", defaultTitle: "Bug" },
  example: { icon: "list", colorClass: "callout-example", defaultTitle: "Example" },
  quote: { icon: "quote", colorClass: "callout-quote", defaultTitle: "Quote" },
  cite: { icon: "quote", colorClass: "callout-quote", defaultTitle: "Cite" },
};

function getCalloutDef(type: string): CalloutDef {
  return CALLOUT_TYPES[type.toLowerCase()] ?? {
    icon: "message-circle",
    colorClass: "callout-note",
    defaultTitle: type.charAt(0).toUpperCase() + type.slice(1),
  };
}

import { iconSvg } from "./inlineSvgIcons";
import { headingFoldRange } from "./headingFold";

class HeadingFoldWidget extends WidgetType {
  lineStart: number;
  folded: boolean;

  constructor(lineStart: number, folded: boolean) {
    super();
    this.lineStart = lineStart;
    this.folded = folded;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-heading-fold ${this.folded ? "folded" : ""}`;
    span.innerHTML = iconSvg("chevron-right", 14);
    span.title = this.folded ? "Unfold section" : "Fold section";
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const range = headingFoldRange(view.state, this.lineStart, view.state.doc.lineAt(this.lineStart).to);
      if (!range) return;
      if (this.folded) {
        view.dispatch({ effects: unfoldEffect.of({ from: range.from, to: range.to }) });
      } else {
        view.dispatch({ effects: foldEffect.of({ from: range.from, to: range.to }) });
      }
    });
    return span;
  }

  eq(other: HeadingFoldWidget): boolean {
    return this.lineStart === other.lineStart && this.folded === other.folded;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class CalloutHeaderWidget extends WidgetType {
  icon: string;
  title: string;
  foldable: boolean;
  collapsed: boolean;
  colorClass: string;
  headerPos: number;

  constructor(icon: string, title: string, foldable: boolean, collapsed: boolean, colorClass: string, headerPos: number) {
    super();
    this.icon = icon;
    this.title = title;
    this.foldable = foldable;
    this.collapsed = collapsed;
    this.colorClass = colorClass;
    this.headerPos = headerPos;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = `cm-callout-header ${this.colorClass}`;

    const iconEl = document.createElement("span");
    iconEl.className = "cm-callout-icon";
    iconEl.innerHTML = iconSvg(this.icon, 18);
    wrapper.appendChild(iconEl);

    const titleEl = document.createElement("span");
    titleEl.className = "cm-callout-title";
    titleEl.textContent = this.title;
    wrapper.appendChild(titleEl);

    if (this.foldable) {
      const chevron = document.createElement("span");
      chevron.className = `cm-callout-fold ${this.collapsed ? "collapsed" : ""}`;
      chevron.innerHTML = iconSvg("chevron-right", 14);
      chevron.style.cursor = "pointer";
      chevron.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.dispatch({ effects: toggleCalloutFold.of(this.headerPos) });
      });
      wrapper.appendChild(chevron);
    }

    return wrapper;
  }

  get estimatedHeight(): number {
    return getBaseLineHeight() + 12; // line + padding
  }

  eq(other: CalloutHeaderWidget): boolean {
    return this.icon === other.icon && this.title === other.title &&
      this.foldable === other.foldable && this.collapsed === other.collapsed &&
      this.colorClass === other.colorClass && this.headerPos === other.headerPos;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// Alt checkbox marker → display config
// Basic 7: SVG mini-icons inside bordered box (task lifecycle)
// Extras 16: custom editorial marginalia (filled/stroke hybrid glyphs)
const BASIC_MARKERS = " x/-><!";
const CHECKBOX_VARIANTS: Record<string, { svg: string; cls: string; label: string }> = {
  // ── Basic 7: task states ──
  " ": { svg: "",         cls: "cb-todo",      label: "to-do" },
  "x": { svg: "cb-check", cls: "cb-done",      label: "done" },
  "/": { svg: "cb-slash", cls: "cb-partial",   label: "partial" },
  "-": { svg: "cb-minus", cls: "cb-canceled",  label: "canceled" },
  ">": { svg: "cb-right", cls: "cb-delegated", label: "delegated" },
  "<": { svg: "cb-left",  cls: "cb-scheduled", label: "scheduled" },
  "!": { svg: "cb-bang",  cls: "cb-important", label: "important" },
  // ── Extras 16: editorial marginalia ──
  "?": { svg: "x-question",   cls: "cb-question",  label: "question" },
  "*": { svg: "x-star",       cls: "cb-star",      label: "star" },
  '"': { svg: "x-quote",      cls: "cb-quote",     label: "quote" },
  "l": { svg: "x-location",   cls: "cb-location",  label: "location" },
  "b": { svg: "x-bookmark",   cls: "cb-bookmark",  label: "bookmark" },
  "i": { svg: "x-info",       cls: "cb-info",      label: "information" },
  "S": { svg: "x-savings",    cls: "cb-savings",   label: "savings" },
  "I": { svg: "x-idea",       cls: "cb-idea",      label: "idea" },
  "p": { svg: "x-pros",       cls: "cb-pros",      label: "pros" },
  "c": { svg: "x-cons",       cls: "cb-cons",      label: "cons" },
  "f": { svg: "x-fire",       cls: "cb-fire",      label: "fire" },
  "k": { svg: "x-key",        cls: "cb-key",       label: "key" },
  "w": { svg: "x-win",        cls: "cb-win",       label: "win" },
  "u": { svg: "x-up",         cls: "cb-up",        label: "up" },
  "d": { svg: "x-down",       cls: "cb-down",      label: "down" },
  "n": { svg: "x-pin",        cls: "cb-pin",       label: "pin" },
};

class CheckboxWidget extends WidgetType {
  marker: string;
  bracketPos: number;

  constructor(marker: string, bracketPos: number) {
    super();
    this.marker = marker;
    this.bracketPos = bracketPos;
  }

  toDOM(view: EditorView): HTMLElement {
    const variant = CHECKBOX_VARIANTS[this.marker] ?? CHECKBOX_VARIANTS[" "];
    const isBasic = BASIC_MARKERS.includes(this.marker);

    const span = document.createElement("span");
    span.className = `cm-preview-alt-cb ${variant.cls}`;
    if (variant.svg) {
      // Basic: 10px icon, bolder stroke inside 14px box
      // Extras: 13px bare icon, standard stroke
      span.innerHTML = iconSvg(variant.svg, isBasic ? 10 : 13, 2.5);
    }
    span.title = variant.label;

    // Basic checkboxes toggle on click: unchecked ↔ checked, alt basic states → checked
    if (BASIC_MARKERS.includes(this.marker)) {
      span.style.cursor = "pointer";
      span.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const replacement = this.marker === "x" ? "[ ]" : "[x]";
        view.dispatch({
          changes: { from: this.bracketPos, to: this.bracketPos + 3, insert: replacement },
        });
      });
    }

    return span;
  }

  eq(other: CheckboxWidget): boolean {
    return this.marker === other.marker && this.bracketPos === other.bracketPos;
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

  get estimatedHeight(): number {
    return Math.max(8, getBaseLineHeight() * 0.3 + 1);
  }

  eq(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-preview-bullet";
    span.textContent = "•";
    return span;
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
  tableText: string;
  parsedTable: Table;
  rowCount: number;

  constructor(tableText: string, parsedTable: Table) {
    super();
    this.tableText = tableText;
    this.parsedTable = parsedTable;
    this.rowCount = parsedTable.getHeight();
  }

  eq(other: TableWidget): boolean {
    return this.tableText === other.tableText;
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

    // Wrapper div — avoids margin collapsing issues with CM6 height measurement
    const wrapper = document.createElement("div");
    wrapper.style.padding = "4px 0";

    const el = document.createElement("table");
    el.className = "cm-preview-table";
    el.style.borderCollapse = "collapse";

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

    wrapper.appendChild(el);
    return wrapper;
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

const BLOCKQUOTE_RE = /^(\s*>)\s?/;
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
const CHECKBOX_RE = /^(\s*[-*+]\s)\[([ x/\-><!?*"libSIpcfkwudn])\]\s/;
const BULLET_RE = /^(\s*)([-*+])\s/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const TAG_RE = /(?<=^|\s)#([a-zA-Z][\w/-]*)/g;
const CALLOUT_RE = /^(\s*>)\s*\[!(\w+)\]([+-])?\s*(.*)/;
const BARE_URL_RE = /(?<![(\[])https?:\/\/[^\s<>\[\])(]+(?:\([^\s<>]*\))*[^\s<>\[\])("',.:;!?]/g;
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
const COMMENT_RE = /%%(.+?)%%/g;

// ── Hoisted decoration objects (immutable, reused across calls) ──

const DECO_REPLACE = Decoration.replace({});
const DECO_REPLACE_OPEN = Decoration.replace({ inclusiveEnd: false });
const DECO_BOLD = Decoration.mark({ class: "cm-preview-bold" });
const DECO_ITALIC = Decoration.mark({ class: "cm-preview-italic" });
const DECO_BOLD_ITALIC = Decoration.mark({ class: "cm-preview-bold cm-preview-italic" });
const DECO_STRIKETHROUGH = Decoration.mark({ class: "cm-preview-strikethrough" });
const DECO_HIGHLIGHT = Decoration.mark({ class: "cm-preview-highlight" });
const DECO_WIKILINK = Decoration.mark({ class: "cm-preview-wikilink" });
const DECO_CHECKED = Decoration.mark({ class: "cm-preview-checked" });
const DECO_DIMMED = Decoration.mark({ class: "cm-preview-dimmed" });
const DECO_CODE_NOOP = Decoration.mark({ class: "cm-preview-code" });
const DECO_URL = Decoration.mark({ class: "cm-preview-url" });
class MdLinkWidget extends WidgetType {
  text: string;
  url: string;
  constructor(text: string, url: string) { super(); this.text = text; this.url = url; }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-preview-url";
    span.textContent = this.text;
    span.dataset.url = this.url;
    return span;
  }
  eq(other: MdLinkWidget) { return this.text === other.text && this.url === other.url; }
  ignoreEvent() { return false; }
}
class TagChipWidget extends WidgetType {
  text: string;
  constructor(text: string) { super(); this.text = text; }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-preview-tag";
    span.textContent = this.text;
    return span;
  }
  eq(other: TagChipWidget) { return this.text === other.text; }
}

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
): {
  skipLines: Set<number>;
  focusedTableLines: Set<number>;
  decos: { from: number; to: number; text: string; table: Table }[];
} {
  const doc = view.state.doc;
  const cursorLine = doc.lineAt(view.state.selection.main.head).number;
  const skipLines = new Set<number>();
  const focusedTableLines = new Set<number>();
  const decos: { from: number; to: number; text: string; table: Table }[] = [];

  for (const { from, to } of view.visibleRanges) {
    const tables = findTablesInRange(view.state, from, to);
    for (const t of tables) {
      const tableStartLine = doc.lineAt(t.from).number;
      const tableEndLine = doc.lineAt(t.to).number;

      if (fmEnd > 0 && tableStartLine <= fmEnd) continue;

      if (cursorLine >= tableStartLine && cursorLine <= tableEndLine) {
        for (let ln = tableStartLine; ln <= tableEndLine; ln++) {
          focusedTableLines.add(ln);
        }
        continue;
      }

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

  return { skipLines, focusedTableLines, decos };
}

const DECO_TABLE_LINE = Decoration.line({ class: "cm-focused-table-line" });

function buildPreviewDecorations(view: EditorView, scan: PreScanResult, tableSkipLines: Set<number>, focusedTableLines: Set<number>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const { fmEnd, codeBlockStates } = scan;

  const cursorLine = doc.lineAt(view.state.selection.main.head).number;

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;

    let inCodeBlock = codeBlockStates.get(startLine) ?? false;
    // Track block comments (%%...%%) and callouts across lines
    let inBlockComment = false;
    let activeCallout: { def: CalloutDef; foldable: boolean; collapsed: boolean } | null = null;
    // Cache heading fold ranges per visible range (avoid double tree walk per heading)
    const headingFoldCache = new Map<number, { from: number; to: number } | null>();
    function getCachedFoldRange(lineFrom: number, lineTo: number) {
      if (headingFoldCache.has(lineFrom)) return headingFoldCache.get(lineFrom)!;
      const range = headingFoldRange(view.state, lineFrom, lineTo);
      headingFoldCache.set(lineFrom, range);
      return range;
    }

    for (let i = startLine; i <= endLine; i++) {
      const line = doc.line(i);

      // Skip lines covered by table widgets
      if (tableSkipLines.has(i)) continue;

      // Monospace font for focused (editing) table lines
      if (focusedTableLines.has(i)) {
        builder.add(line.from, line.from, DECO_TABLE_LINE);
      }

      const text = line.text;

      // Skip frontmatter
      if (fmEnd > 0 && i <= fmEnd) continue;

      // Track code blocks (must run even on cursor line to keep state correct)
      if (text.trimStart().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        activeCallout = null;
        if (i === cursorLine) continue;
        continue;
      }
      if (inCodeBlock) continue;

      // Track block comments (%% on its own line)
      if (text.trim() === "%%") {
        inBlockComment = !inBlockComment;
        if (i !== cursorLine) {
          builder.add(line.from, line.from, Decoration.line({ class: "cm-comment-hidden" }));
        }
        continue;
      }
      if (inBlockComment) {
        if (i !== cursorLine) {
          builder.add(line.from, line.from, Decoration.line({ class: "cm-comment-hidden" }));
        }
        continue;
      }

      // Reset callout tracking on non-blockquote lines
      const bqMatch = text.match(BLOCKQUOTE_RE);
      if (!bqMatch) {
        activeCallout = null;
      }

      // Skip the focus line — show raw markdown there
      if (i === cursorLine) continue;

      // ── Blockquotes & Callouts ──
      if (bqMatch) {
        // Check if this is a callout header: > [!type]
        const calloutMatch = text.match(CALLOUT_RE);
        if (calloutMatch) {
          const def = getCalloutDef(calloutMatch[2]);
          const foldMarker = calloutMatch[3]; // "-", "+", or undefined
          const foldable = foldMarker === "-" || foldMarker === "+";
          const rawTitle = calloutMatch[4]?.replace(/%% %%/, "").trim();
          const title = rawTitle || def.defaultTitle;

          const collapsedSet = view.state.field(calloutFoldField);
          // `-` defaults to collapsed (unless user toggled), `+` defaults to expanded
          const defaultCollapsed = foldMarker === "-";
          const isCollapsed = collapsedSet.has(line.from) ? !defaultCollapsed : defaultCollapsed;
          activeCallout = { def, foldable, collapsed: foldable && isCollapsed };

          // Line decoration for callout styling
          const headerClass = activeCallout.collapsed
            ? `cm-callout cm-callout-header-line cm-callout-solo cm-${def.colorClass}`
            : `cm-callout cm-callout-header-line cm-${def.colorClass}`;
          builder.add(line.from, line.from, Decoration.line({ class: headerClass }));
          // Replace entire line content with callout header widget
          builder.add(
            line.from,
            line.to,
            Decoration.replace({
              widget: new CalloutHeaderWidget(def.icon, title, foldable, isCollapsed, def.colorClass, line.from),
            })
          );
          continue;
        }

        // Continuation line inside a callout
        if (activeCallout) {
          // If collapsed, hide body lines
          if (activeCallout.collapsed) {
            builder.add(line.from, line.from, Decoration.line({ class: "cm-callout-hidden" }));
            builder.add(line.from, line.to, DECO_REPLACE);
            continue;
          }
          builder.add(
            line.from,
            line.from,
            Decoration.line({ class: `cm-callout cm-callout-body-line cm-${activeCallout.def.colorClass}` })
          );
          // Hide the "> " marker
          builder.add(line.from, line.from + bqMatch[0].length, DECO_REPLACE);
          // Process inline decorations on the content after "> "
          const afterBq = text.slice(bqMatch[0].length);
          if (afterBq.length > 0) {
            const contentLine = { from: line.from + bqMatch[0].length, to: line.to };
            addInlineDecorations(builder, contentLine, afterBq);
          }
          continue;
        }

        // Regular blockquote (no callout)
        builder.add(
          line.from,
          line.from,
          Decoration.line({ class: "cm-preview-blockquote" })
        );
        // Hide the "> " marker
        builder.add(line.from, line.from + bqMatch[0].length, DECO_REPLACE);
        continue;
      }

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
        // Hide # markers + add fold chevron widget before heading text
        const markerLen = headingMatch[0].length;
        builder.add(line.from, line.from + markerLen, DECO_REPLACE);
        const foldRange = getCachedFoldRange(line.from, line.to);
        if (foldRange) {
          let isFolded = false;
          const iter = foldedRanges(view.state).iter();
          while (iter.value) {
            if (iter.from === foldRange.from && iter.to === foldRange.to) {
              isFolded = true;
              break;
            }
            iter.next();
          }
          builder.add(
            line.from + markerLen,
            line.from + markerLen,
            Decoration.widget({ widget: new HeadingFoldWidget(line.from, isFolded), side: -1 })
          );
        }
        // Process inline formatting on the text after the markers
        const headingContent = text.slice(markerLen);
        const contentLine = { from: line.from + markerLen, to: line.to };
        addInlineDecorations(builder, contentLine, headingContent);
        continue;
      }

      // ── Checkboxes ──
      const cbMatch = text.match(CHECKBOX_RE);
      if (cbMatch) {
        const marker = cbMatch[2];
        const bracketStart = line.from + cbMatch[1].length;
        const indent = cbMatch[1].match(/^\s*/)?.[0].length ?? 0;
        // Replace "- [ ] " (marker + checkbox + space) with just the checkbox widget
        builder.add(
          line.from + indent,
          bracketStart + 4, // through [x] + trailing space
          Decoration.replace({
            widget: new CheckboxWidget(marker, bracketStart),
          })
        );
        // Canceled: strikethrough + dim. Done: dim only.
        if (marker === "-" || marker === "x") {
          builder.add(
            bracketStart + 4,
            line.to,
            marker === "-" ? DECO_CHECKED : DECO_DIMMED
          );
        } else {
          // Process inline decorations on text after the checkbox marker
          const afterCb = text.slice(cbMatch[0].length);
          if (afterCb.length > 0) {
            const cbContentLine = { from: line.from + cbMatch[0].length, to: line.to };
            addInlineDecorations(builder, cbContentLine, afterCb);
          }
        }
        continue;
      }

      // ── Bullet list markers ──
      const bulletMatch = text.match(BULLET_RE);
      if (bulletMatch) {
        const indent = bulletMatch[1].length;
        const markerStart = line.from + indent;
        // Replace the marker character (-, *, +) with a bullet dot
        builder.add(
          markerStart,
          markerStart + 1,
          Decoration.replace({ widget: new BulletWidget() })
        );
        // Process inline decorations on the rest of the line
        const afterBullet = text.slice(bulletMatch[0].length);
        if (afterBullet.length > 0) {
          const contentLine = { from: line.from + bulletMatch[0].length, to: line.to };
          addInlineDecorations(builder, contentLine, afterBullet);
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
      ranges.push({ from: to - markerLen, to, deco: DECO_REPLACE_OPEN });
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
  matchInline(INLINE_CODE_RE, 1, DECO_CODE_NOOP);

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
    ranges.push({ from: to - 2, to, deco: DECO_REPLACE_OPEN });
  }

  // Markdown links [text](url) — replace with styled display text
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (isClaimed(from, to)) continue;
    ranges.push({
      from,
      to,
      deco: Decoration.replace({ widget: new MdLinkWidget(m[1], m[2]), inclusiveEnd: false }),
    });
    claimed.push({ from, to });
  }

  // Bare URLs — mark as styled
  BARE_URL_RE.lastIndex = 0;
  while ((m = BARE_URL_RE.exec(text)) !== null) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (isClaimed(from, to)) continue;
    ranges.push({ from, to, deco: DECO_URL });
    claimed.push({ from, to });
  }

  // Inline comments %%...%% — hide entirely in preview
  COMMENT_RE.lastIndex = 0;
  while ((m = COMMENT_RE.exec(text)) !== null) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (isClaimed(from, to)) continue;
    ranges.push({ from, to, deco: DECO_REPLACE });
    claimed.push({ from, to });
  }

  // Tags — replace entire #tag with a single widget chip
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    const hashFrom = line.from + m.index;
    const tagTo = hashFrom + m[0].length;
    if (isClaimed(hashFrom, tagTo)) continue;
    ranges.push({
      from: hashFrom,
      to: tagTo,
      deco: Decoration.replace({ widget: new TagChipWidget(m[1]), inclusiveEnd: false }),
    });
    claimed.push({ from: hashFrom, to: tagTo });
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
        this.decorations = buildPreviewDecorations(view, this.scan, td.skipLines, td.focusedTableLines);
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
      const calloutFoldChanged = update.startState.field(calloutFoldField) !== update.state.field(calloutFoldField);
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.startState.field(previewModeField) !== active ||
        calloutFoldChanged
      ) {
        const td = detectTableRanges(update.view, this.scan.fmEnd);
        this.tableSkipLines = td.skipLines;
        this.decorations = buildPreviewDecorations(update.view, this.scan, td.skipLines, td.focusedTableLines);
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
    background: "var(--syntax-highlight-bg, rgba(255, 204, 0, 0.3))",
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
    opacity: "0.5",
  },
  ".cm-preview-dimmed": {
    opacity: "0.5",
  },
  ".cm-preview-comment": {
    display: "none",
  },
  ".cm-preview-wikilink": {
    color: "var(--link-color)",
    cursor: "pointer",
    textDecoration: "var(--link-underline, underline)",
    textUnderlineOffset: "2px",
  },
  ".cm-preview-url": {
    color: "var(--link-color)",
    cursor: "pointer",
    textDecoration: "var(--link-underline, underline)",
    textUnderlineOffset: "2px",
  },
  ".cm-preview-tag": {
    background: "var(--tag-bg)",
    color: "var(--tag-text)",
    borderRadius: "9px",
    padding: "1px 8px",
    fontSize: "0.88em",
  },
});

// ── Export ──

export function livePreviewExtension(): Extension[] {
  return [previewModeField, calloutFoldField, livePreviewPlugin, tableBlockField, previewTheme];
}
