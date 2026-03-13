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
  type Extension,
} from "@codemirror/state";

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

// ── Patterns ──

const HEADING_RE = /^(#{1,6})\s+/;
const BOLD_ITALIC_RE = /\*{3}(.+?)\*{3}/g;
const BOLD_RE = /\*{2}(.+?)\*{2}/g;
const ITALIC_RE = /(?<!\*)\*([^*]+)\*(?!\*)/g;
const CHECKBOX_RE = /^(\s*[-*+]\s)\[([ x])\]\s/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// ── Hoisted decoration objects (immutable, reused across calls) ──

const DECO_REPLACE = Decoration.replace({});
const DECO_BOLD = Decoration.mark({ class: "cm-preview-bold" });
const DECO_ITALIC = Decoration.mark({ class: "cm-preview-italic" });
const DECO_BOLD_ITALIC = Decoration.mark({ class: "cm-preview-bold cm-preview-italic" });
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

function buildPreviewDecorations(view: EditorView, scan: PreScanResult): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const { fmEnd, codeBlockStates } = scan;

  // Find the cursor line (focus line shows raw markdown)
  const cursorLine = doc.lineAt(view.state.selection.main.head).number;

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;

    let inCodeBlock = codeBlockStates.get(startLine) ?? false;

    for (let i = startLine; i <= endLine; i++) {
      const line = doc.line(i);

      // Skip the focus line — show raw markdown there
      if (i === cursorLine) continue;

      const text = line.text;

      // Skip frontmatter
      if (fmEnd > 0 && i <= fmEnd) continue;

      // Track code blocks
      if (text.trimStart().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

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

  // Bold+Italic (***text***) — must come before bold/italic
  BOLD_ITALIC_RE.lastIndex = 0;
  while ((m = BOLD_ITALIC_RE.exec(text)) !== null) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    ranges.push({ from, to: from + 3, deco: DECO_REPLACE });
    ranges.push({ from: from + 3, to: to - 3, deco: DECO_BOLD_ITALIC });
    ranges.push({ from: to - 3, to, deco: DECO_REPLACE });
    claimed.push({ from, to });
  }

  // Bold (**text**)
  BOLD_RE.lastIndex = 0;
  while ((m = BOLD_RE.exec(text)) !== null) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (isClaimed(from, to)) continue;
    ranges.push({ from, to: from + 2, deco: DECO_REPLACE });
    ranges.push({ from: from + 2, to: to - 2, deco: DECO_BOLD });
    ranges.push({ from: to - 2, to, deco: DECO_REPLACE });
    claimed.push({ from, to });
  }

  // Italic (*text*)
  ITALIC_RE.lastIndex = 0;
  while ((m = ITALIC_RE.exec(text)) !== null) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (isClaimed(from, to)) continue;
    ranges.push({ from, to: from + 1, deco: DECO_REPLACE });
    ranges.push({ from: from + 1, to: to - 1, deco: DECO_ITALIC });
    ranges.push({ from: to - 1, to, deco: DECO_REPLACE });
    claimed.push({ from, to });
  }

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

    constructor(view: EditorView) {
      this.scan = preScanDocument(view);
      const active = view.state.field(previewModeField);
      this.decorations = active
        ? buildPreviewDecorations(view, this.scan)
        : Decoration.none;
    }

    update(update: ViewUpdate) {
      const active = update.view.state.field(previewModeField);
      if (!active) {
        this.decorations = Decoration.none;
        return;
      }
      // Only re-scan on doc/viewport change (expensive), not on cursor move
      if (update.docChanged || update.viewportChanged) {
        this.scan = preScanDocument(update.view);
      }
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.startState.field(previewModeField) !== active
      ) {
        this.decorations = buildPreviewDecorations(update.view, this.scan);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// ── Theme ──

const previewTheme = EditorView.theme({
  ".cm-preview-heading": {
    fontWeight: "600",
  },
  ".cm-preview-h1": {
    fontSize: "1.6em",
    lineHeight: "1.3",
  },
  ".cm-preview-h2": {
    fontSize: "1.3em",
    lineHeight: "1.3",
  },
  ".cm-preview-h3": {
    fontSize: "1.1em",
    lineHeight: "1.4",
  },
  ".cm-preview-h4, .cm-preview-h5, .cm-preview-h6": {
    fontSize: "1em",
  },
  ".cm-preview-bold": {
    fontWeight: "700",
  },
  ".cm-preview-italic": {
    fontStyle: "italic",
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
    textDecoration: "none",
    borderBottom: "1px solid var(--link-color)",
    paddingBottom: "1px",
  },
  ".cm-preview-tag": {
    background: "var(--accent-muted)",
    color: "var(--accent)",
    borderRadius: "3px",
    padding: "1px 4px",
    fontSize: "0.9em",
  },
});

// ── Export ──

export function livePreviewExtension(): Extension[] {
  return [previewModeField, livePreviewPlugin, previewTheme];
}
