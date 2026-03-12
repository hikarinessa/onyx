import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
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
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-preview-checkbox";
    input.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const line = view.state.doc.lineAt(this.pos);
      const text = line.text;
      const bracketIdx = text.indexOf(this.checked ? "[x]" : "[ ]");
      if (bracketIdx === -1) return;
      const from = line.from + bracketIdx;
      const replacement = this.checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from, to: from + 3, insert: replacement },
      });
    });
    return input;
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.pos === other.pos;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// ── Patterns ──

const HEADING_RE = /^(#{1,6})\s+/;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const ITALIC_RE = /(?<!\*)\*([^*]+)\*(?!\*)/g;
const CHECKBOX_RE = /^(\s*[-*+]\s)\[([ x])\]\s/;
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// ── Decoration builder ──

function buildPreviewDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  // Find the cursor line (focus line shows raw markdown)
  const cursorLine = doc.lineAt(view.state.selection.main.head).number;

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;

    for (let i = startLine; i <= endLine; i++) {
      const line = doc.line(i);

      // Skip the focus line — show raw markdown there
      if (i === cursorLine) continue;

      const text = line.text;

      // Skip frontmatter
      if (i === 1 && text.trim() === "---") {
        // Skip until closing ---
        let j = i + 1;
        while (j <= endLine) {
          if (doc.line(j).text.trim() === "---") break;
          j++;
        }
        i = j;
        continue;
      }

      // Skip code blocks
      if (text.trimStart().startsWith("```")) continue;

      // ── Headings ──
      const headingMatch = text.match(HEADING_RE);
      if (headingMatch) {
        const level = headingMatch[1].length;
        // Hide # markers
        builder.add(
          line.from,
          line.from + headingMatch[0].length,
          Decoration.replace({})
        );
        // Style the whole line
        builder.add(
          line.from,
          line.from,
          Decoration.line({ class: `cm-preview-heading cm-preview-h${level}` })
        );
        // Still process inline formatting on heading lines
        addInlineDecorations(builder, line, text, headingMatch[0].length);
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
            widget: new CheckboxWidget(checked, line.from),
          })
        );
        if (checked) {
          builder.add(
            bracketStart + 4,
            line.to,
            Decoration.mark({ class: "cm-preview-checked" })
          );
        }
        continue;
      }

      // ── Inline decorations ──
      addInlineDecorations(builder, line, text, 0);
    }
  }

  return builder.finish();
}

/** Add inline decorations (bold, italic, wikilinks) to a line */
function addInlineDecorations(
  builder: RangeSetBuilder<Decoration>,
  line: { from: number; to: number },
  text: string,
  _offset: number,
): void {
  // Collect all inline ranges to avoid overlapping decorations
  const ranges: { from: number; to: number; deco: Decoration }[] = [];

  // Bold
  BOLD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOLD_RE.exec(text)) !== null) {
    const from = line.from + m.index;
    // Hide opening **
    ranges.push({ from, to: from + 2, deco: Decoration.replace({}) });
    // Style content
    ranges.push({
      from: from + 2,
      to: from + m[0].length - 2,
      deco: Decoration.mark({ class: "cm-preview-bold" }),
    });
    // Hide closing **
    ranges.push({
      from: from + m[0].length - 2,
      to: from + m[0].length,
      deco: Decoration.replace({}),
    });
  }

  // Italic (must not be inside bold)
  ITALIC_RE.lastIndex = 0;
  while ((m = ITALIC_RE.exec(text)) !== null) {
    const from = line.from + m.index;
    // Check if this overlaps with any bold range
    const overlaps = ranges.some(
      (r) => from < r.to && from + m![0].length > r.from
    );
    if (overlaps) continue;
    ranges.push({ from, to: from + 1, deco: Decoration.replace({}) });
    ranges.push({
      from: from + 1,
      to: from + m[0].length - 1,
      deco: Decoration.mark({ class: "cm-preview-italic" }),
    });
    ranges.push({
      from: from + m[0].length - 1,
      to: from + m[0].length,
      deco: Decoration.replace({}),
    });
  }

  // Wikilinks
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const from = line.from + m.index;
    const displayText = m[2] || m[1]; // Use alias if present
    // Hide [[ and ]]
    ranges.push({ from, to: from + 2, deco: Decoration.replace({}) });
    // If there's an alias (|), hide from the | to ]]
    if (m[2]) {
      const pipeIdx = m[0].indexOf("|");
      ranges.push({
        from: from + 2,
        to: from + pipeIdx + 1,
        deco: Decoration.replace({}),
      });
    }
    // Style the display text
    const displayFrom = m[2] ? from + m[0].indexOf("|") + 1 : from + 2;
    const displayTo = from + m[0].length - 2;
    ranges.push({
      from: displayFrom,
      to: displayTo,
      deco: Decoration.mark({ class: "cm-preview-wikilink" }),
    });
    // Hide ]]
    ranges.push({
      from: from + m[0].length - 2,
      to: from + m[0].length,
      deco: Decoration.replace({}),
    });
  }

  // Sort by from position and add to builder
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

    constructor(view: EditorView) {
      const active = view.state.field(previewModeField);
      this.decorations = active
        ? buildPreviewDecorations(view)
        : Decoration.none;
    }

    update(update: {
      docChanged: boolean;
      viewportChanged: boolean;
      selectionSet: boolean;
      view: EditorView;
      startState: { field: typeof update.view.state.field };
    }) {
      const active = update.view.state.field(previewModeField);
      if (!active) {
        this.decorations = Decoration.none;
        return;
      }
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.startState.field(previewModeField) !== active
      ) {
        this.decorations = buildPreviewDecorations(update.view);
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
