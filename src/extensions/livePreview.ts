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
import { indentUnit, syntaxTree, foldEffect, unfoldEffect, foldedRanges } from "@codemirror/language";
import { getIndentGuides } from "../lib/configBridge";
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

// ── List fold state ──

/** Toggle a list item's collapsed state. Value is the doc position of the list item line start. */
const toggleListFold = StateEffect.define<number>();

/**
 * Tracks which list items are collapsed, by document position (line start).
 * Positions are remapped via mapPos on edits so they survive insertions/deletions.
 */
const listFoldField = StateField.define<Set<number>>({
  create: () => new Set(),
  update(collapsed, tr) {
    let updated = collapsed;
    for (const e of tr.effects) {
      if (e.is(toggleListFold)) {
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
import { listFoldRange } from "./outliner";
import { wikilinkFollowRef } from "./wikilinks";

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

class ListFoldWidget extends WidgetType {
  lineStart: number;
  folded: boolean;

  constructor(lineStart: number, folded: boolean) {
    super();
    this.lineStart = lineStart;
    this.folded = folded;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-list-fold ${this.folded ? "folded" : ""}`;
    span.innerHTML = iconSvg("chevron-right", 12);
    span.title = this.folded ? "Unfold list" : "Fold list";
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({ effects: toggleListFold.of(this.lineStart) });
    });
    return span;
  }

  eq(other: ListFoldWidget): boolean {
    return this.lineStart === other.lineStart && this.folded === other.folded;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class CodeFenceLabelWidget extends WidgetType {
  lang: string;

  constructor(lang: string) {
    super();
    this.lang = lang;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-codeblock-lang";
    span.textContent = this.lang;
    return span;
  }

  eq(other: CodeFenceLabelWidget): boolean {
    return this.lang === other.lang;
  }

  ignoreEvent(): boolean {
    return true;
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

/**
 * Render cell text with inline markdown formatting into a DOM element.
 * Supports: bold, italic, bold+italic, strikethrough, highlight, inline code, wikilinks, tags.
 */
function renderCellContent(el: HTMLElement, text: string): void {
  // Groups: 1=inline code, 2=bold+italic, 3=bold, 4=italic, 5=strikethrough, 6=highlight, 7=wikilink target, 8=wikilink alias, 9=tag
  const CELL_RE = /(`[^`]+`)|(\*{3}.+?\*{3})|(\*{2}.+?\*{2})|(\*[^*]+\*)|(~~.+?~~)|(==.+?==)|(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|(?<=^|\s)#([a-zA-Z][\w/-]*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CELL_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      el.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    lastIndex = match.index + match[0].length;

    if (match[1]) {
      // Inline code
      const code = document.createElement("code");
      code.className = "cm-preview-table-code";
      code.textContent = match[1].slice(1, -1);
      el.appendChild(code);
    } else if (match[2]) {
      // Bold+Italic ***text***
      const span = document.createElement("span");
      span.className = "cm-preview-table-bold-italic";
      span.textContent = match[2].slice(3, -3);
      el.appendChild(span);
    } else if (match[3]) {
      // Bold **text**
      const span = document.createElement("strong");
      span.textContent = match[3].slice(2, -2);
      el.appendChild(span);
    } else if (match[4]) {
      // Italic *text*
      const span = document.createElement("em");
      span.textContent = match[4].slice(1, -1);
      el.appendChild(span);
    } else if (match[5]) {
      // Strikethrough ~~text~~
      const span = document.createElement("s");
      span.className = "cm-preview-table-strikethrough";
      span.textContent = match[5].slice(2, -2);
      el.appendChild(span);
    } else if (match[6]) {
      // Highlight ==text==
      const span = document.createElement("mark");
      span.className = "cm-preview-table-highlight";
      span.textContent = match[6].slice(2, -2);
      el.appendChild(span);
    } else if (match[7]) {
      // Wikilink [[target|alias]] or [[target]]
      const span = document.createElement("span");
      span.className = "cm-preview-wikilink";
      span.textContent = match[8] ?? match[7];
      span.dataset.link = match[7];
      el.appendChild(span);
    } else if (match[9]) {
      // Tag #tag
      const span = document.createElement("span");
      span.className = "cm-preview-tag";
      span.textContent = match[9];
      el.appendChild(span);
    }
  }

  // Append remaining text
  if (lastIndex < text.length) {
    el.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  // If nothing was appended (empty text), ensure something is there
  if (!el.hasChildNodes()) {
    el.appendChild(document.createTextNode(text));
  }
}

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
    wrapper.style.overflowX = "auto";

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
        renderCellContent(th, headerCells[c].content);
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
          renderCellContent(td, cells[c].content);
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

    // Handle wikilink clicks inside the table widget
    wrapper.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const wikilink = target.closest<HTMLElement>(".cm-preview-wikilink[data-link]");
      if (wikilink && wikilinkFollowRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const link = wikilink.dataset.link!;
        wikilinkFollowRef.current(link, e.metaKey, e.metaKey && e.shiftKey);
      }
    });

    return wrapper;
  }

  ignoreEvent(event: Event): boolean {
    // Let click events through so the wikilink handler can process them
    if (event.type === "mousedown") {
      const target = event.target as HTMLElement;
      if (target.closest?.(".cm-preview-wikilink[data-link]")) return true;
    }
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
const ORDERED_RE = /^(\s*)(\d+\.)\s/;
const WIKILINK_RE = /(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
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
const DECO_DIMMED_LIGHT = Decoration.mark({ class: "cm-preview-dimmed-light" });
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

// ── Hanging indent metrics ──
// Measure actual pixel widths for accurate hanging indents with proportional fonts.
// Cache is invalidated on font/size config changes via resetHangMetrics().
let hangMetrics: { space: number; digit: number; bullet: number; checkbox: number } | null = null;

export function resetHangMetrics() {
  hangMetrics = null;
}

function getHangMetrics(view: EditorView): { space: number; digit: number; bullet: number; checkbox: number } {
  if (hangMetrics) return hangMetrics;
  const container = view.contentDOM;
  const measure = (text: string, className?: string): number => {
    const el = document.createElement("span");
    if (className) el.className = className;
    el.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:inherit";
    el.textContent = text;
    container.appendChild(el);
    const style = getComputedStyle(el);
    const width = el.offsetWidth + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
    el.remove();
    return width;
  };

  const space = measure("          ") / 10;
  const digit = measure("0000000000") / 10;
  const bullet = measure("\u2022", "cm-preview-bullet");
  const checkbox = measure("", "cm-preview-alt-cb") || 14;

  hangMetrics = { space, digit, bullet, checkbox };
  return hangMetrics;
}

/** Build inline style for a list line: hanging indent + vertical indent guides. */
function listLineStyle(hangPx: number, indentSpaces: number, unitLen: number, spaceWidth: number): string {
  let style = `position: relative; padding-left: ${hangPx}px !important; text-indent: -${hangPx}px !important`;
  const depth = unitLen > 0 ? Math.floor(indentSpaces / unitLen) : 0;
  if (depth > 0 && getIndentGuides()) {
    const guides: string[] = [];
    for (let d = 1; d <= depth; d++) {
      const x = d * unitLen * spaceWidth - 7;
      guides.push(`linear-gradient(var(--border-subtle) 0 0) ${x}px 0 / 1px 100% no-repeat`);
    }
    style += `; background: ${guides.join(", ")} !important; background-origin: border-box !important`;
  }
  return style;
}

function buildPreviewDecorations(view: EditorView, scan: PreScanResult, tableSkipLines: Set<number>, focusedTableLines: Set<number>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const { fmEnd, codeBlockStates } = scan;
  const metrics = getHangMetrics(view);
  const unitLen = view.state.facet(indentUnit).length;

  const cursorLine = doc.lineAt(view.state.selection.main.head).number;
  const collapsedLists = view.state.field(listFoldField);

  // Cache list fold ranges to avoid double computation per list item
  const listFoldCache = new Map<number, { from: number; to: number } | null>();
  function getCachedListFold(lineFrom: number, lineTo: number) {
    if (listFoldCache.has(lineFrom)) return listFoldCache.get(lineFrom)!;
    const range = listFoldRange(view.state, lineFrom, lineTo);
    listFoldCache.set(lineFrom, range);
    return range;
  }

  // Pre-compute which lines are hidden by collapsed list items
  const listHiddenLines = new Set<number>();
  for (const pos of collapsedLists) {
    const range = getCachedListFold(pos, doc.lineAt(pos).to);
    if (range) {
      // Hide all lines from the one after the parent to the last child
      const startHide = doc.lineAt(range.from + 1).number; // line after parent
      const endHide = doc.lineAt(range.to).number;
      for (let ln = startHide; ln <= endHide; ln++) {
        listHiddenLines.add(ln);
      }
    }
  }

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

      // Skip embed lines (handled by embedBlockField)
      if (/^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*$/.test(line.text)) continue;

      // Hide lines collapsed by list fold (unless cursor is on them)
      if (listHiddenLines.has(i) && i !== cursorLine) {
        builder.add(line.from, line.from, Decoration.line({ class: "cm-list-fold-hidden" }));
        continue;
      }

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
        const wasInCodeBlock = inCodeBlock;
        inCodeBlock = !inCodeBlock;
        activeCallout = null;
        if (i !== cursorLine) {
          if (!wasInCodeBlock) {
            // Opening fence — show language label, hide backticks
            const lang = text.trimStart().slice(3).trim();
            builder.add(line.from, line.from, Decoration.line({ class: "cm-codeblock-fence cm-codeblock-start" }));
            if (lang) {
              builder.add(line.from, line.to, Decoration.replace({ widget: new CodeFenceLabelWidget(lang) }));
            } else {
              builder.add(line.from, line.to, Decoration.replace({ widget: new CodeFenceLabelWidget("") }));
            }
          } else {
            // Closing fence — fully collapse
            builder.add(line.from, line.from, Decoration.line({ class: "cm-codeblock-fence cm-codeblock-end" }));
            builder.add(line.from, line.to, Decoration.replace({ widget: new CodeFenceLabelWidget("") }));
          }
        }
        continue;
      }
      if (inCodeBlock) {
        if (i !== cursorLine) {
          builder.add(line.from, line.from, Decoration.line({ class: "cm-codeblock-line" }));
        }
        continue;
      }

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
        const hangPx = indent * metrics.space + metrics.checkbox + metrics.space;
        builder.add(line.from, line.from, Decoration.line({
          attributes: { style: listLineStyle(hangPx, indent, unitLen, metrics.space) },
        }));
        // Replace "- [ ] " (marker + checkbox + space) with just the checkbox widget
        builder.add(
          line.from + indent,
          bracketStart + 4, // through [x] + trailing space
          Decoration.replace({
            widget: new CheckboxWidget(marker, bracketStart),
          })
        );
        // Canceled: strikethrough + dim. Done: dim only. Scheduled/delegated: light dim.
        if (marker === "-" || marker === "x") {
          builder.add(
            bracketStart + 4,
            line.to,
            marker === "-" ? DECO_CHECKED : DECO_DIMMED
          );
        } else {
          if (marker === "<" || marker === ">") {
            builder.add(bracketStart + 4, line.to, DECO_DIMMED_LIGHT);
          }
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
        const hangPx = indent * metrics.space + metrics.bullet + metrics.space;
        builder.add(line.from, line.from, Decoration.line({
          attributes: { style: listLineStyle(hangPx, indent, unitLen, metrics.space) },
        }));
        // Fold chevron for list items with nested children — before bullet
        const listFold = getCachedListFold(line.from, line.to);
        if (listFold) {
          const isListFolded = collapsedLists.has(line.from);
          builder.add(markerStart, markerStart, Decoration.widget({
            widget: new ListFoldWidget(line.from, isListFolded),
            side: -1,
          }));
        }
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

      // ── Ordered list markers ──
      const orderedMatch = text.match(ORDERED_RE);
      if (orderedMatch) {
        const indentOl = orderedMatch[1].length;
        const markerText = orderedMatch[2]; // e.g. "1." or "12."
        const hangPx = indentOl * metrics.space + markerText.length * metrics.digit + metrics.space;
        builder.add(line.from, line.from, Decoration.line({
          attributes: { style: listLineStyle(hangPx, indentOl, unitLen, metrics.space) },
        }));
        // Fold chevron for ordered list items with nested children — before number
        const olFold = getCachedListFold(line.from, line.to);
        if (olFold) {
          const isOlFolded = collapsedLists.has(line.from);
          const olMarkerStart = line.from + indentOl;
          builder.add(olMarkerStart, olMarkerStart, Decoration.widget({
            widget: new ListFoldWidget(line.from, isOlFolded),
            side: -1,
          }));
        }
        // Process inline decorations on the rest of the line
        const afterMarker = text.slice(orderedMatch[0].length);
        if (afterMarker.length > 0) {
          const contentLine = { from: line.from + orderedMatch[0].length, to: line.to };
          addInlineDecorations(builder, contentLine, afterMarker);
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

  // Inline code first — claim these ranges so no other decorations apply inside backticks
  matchInline(INLINE_CODE_RE, 1, DECO_CODE_NOOP, false);

  // Order matters: longer markers first to prevent partial matches
  matchInline(BOLD_ITALIC_RE, 3, DECO_BOLD_ITALIC);
  matchInline(BOLD_ITALIC_UNDER_RE, 3, DECO_BOLD_ITALIC);
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
      const listFoldChanged = update.startState.field(listFoldField) !== update.state.field(listFoldField);
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.startState.field(previewModeField) !== active ||
        calloutFoldChanged ||
        listFoldChanged
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
  ".cm-preview-dimmed-light": {
    opacity: "0.7",
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
  ".cm-preview-table": {
    overflowWrap: "normal",
  },
  ".cm-preview-table th, .cm-preview-table td": {
    maxWidth: "300px",
  },
  ".cm-preview-table-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    background: "var(--bg-elevated)",
    borderRadius: "3px",
    padding: "1px 4px",
  },
  ".cm-preview-table-bold-italic": {
    fontWeight: "700",
    fontStyle: "italic",
  },
  ".cm-preview-table-strikethrough": {
    opacity: "0.7",
  },
  ".cm-preview-table-highlight": {
    background: "var(--syntax-highlight-bg, rgba(255, 204, 0, 0.3))",
    borderRadius: "2px",
    padding: "1px 0",
  },
});

// ── Export ──

export function livePreviewExtension(): Extension[] {
  return [previewModeField, calloutFoldField, listFoldField, livePreviewPlugin, tableBlockField, previewTheme];
}
