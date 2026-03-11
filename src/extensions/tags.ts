import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

/**
 * Detects #tags in the editor and applies a styled .cm-tag-highlight class.
 * Matches the same pattern as the Rust indexer: #([a-zA-Z][a-zA-Z0-9_/-]*)
 * preceded by start-of-line or whitespace.
 *
 * Tags inside code blocks (``` fences) or YAML frontmatter (--- fences) are skipped.
 */

// The full pattern: optional leading whitespace or start-of-line, then the #tag
// We capture the position of `#` by checking for a non-word char or line start before it.
const TAG_RE = /(?:^|[\s])#([a-zA-Z][a-zA-Z0-9_/-]*)/g;

/** Find the closing line of YAML frontmatter, or 0 if none */
function frontmatterEndLine(doc: EditorView["state"]["doc"]): number {
  if (doc.lines < 2) return 0;
  if (doc.line(1).text.trim() !== "---") return 0;
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() === "---") return i;
  }
  return 0;
}

/** Build decorations for all #tags in the document, skipping fenced regions */
function buildTagDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const mark = Decoration.mark({ class: "cm-tag-highlight" });

  const fmEnd = frontmatterEndLine(doc);
  let inCodeBlock = false;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;

    // Toggle code fence tracking
    if (text.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip lines inside code blocks or frontmatter
    if (inCodeBlock || (fmEnd > 0 && i <= fmEnd)) continue;

    // Find all tag matches on this line
    let match: RegExpExecArray | null;
    TAG_RE.lastIndex = 0;
    while ((match = TAG_RE.exec(text)) !== null) {
      // The full match may start with a whitespace char — find the `#` position
      const hashOffset = match[0].indexOf("#");
      const from = line.from + match.index + hashOffset;
      const to = line.from + match.index + match[0].length;
      builder.add(from, to, mark);
    }
  }

  return builder.finish();
}

/** ViewPlugin that tracks and rebuilds decorations on doc changes */
const tagDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildTagDecorations(view);
    }

    update(update: { docChanged: boolean; view: EditorView }) {
      if (update.docChanged) {
        this.decorations = buildTagDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

/** Theme for tag decorations */
const tagTheme = EditorView.theme({
  ".cm-tag-highlight": {
    color: "var(--accent)",
    opacity: "0.85",
  },
});

/** Bundle all tag extensions */
export function tagExtension(): Extension[] {
  return [tagDecorations, tagTheme];
}
