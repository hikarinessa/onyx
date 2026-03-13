import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { foldEffect, unfoldEffect, foldedRanges } from "@codemirror/language";

/**
 * Detects YAML frontmatter (--- ... ---) at the start of a document.
 * Applies subtle styling (dimmed, monospace, smaller font) and auto-folds
 * on initial load.
 */

const frontmatterLineDecoration = Decoration.line({
  class: "cm-frontmatter-line",
});

const frontmatterDelimiterDecoration = Decoration.line({
  class: "cm-frontmatter-delimiter",
});

/** Find the frontmatter range: returns {from, to} or null */
function findFrontmatter(doc: { lines: number; line(n: number): { text: string; from: number; to: number } }) {
  if (doc.lines < 2) return null;
  const firstLine = doc.line(1);
  if (firstLine.text.trim() !== "---") return null;

  for (let i = 2; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text.trim() === "---") {
      return { from: firstLine.from, to: line.to, closingLine: i };
    }
  }
  return null;
}

/** Decorations plugin — styles frontmatter lines */
const frontmatterDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: { docChanged: boolean; view: EditorView }) {
      if (update.docChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const fm = findFrontmatter(view.state.doc);
      if (!fm) return builder.finish();

      for (let i = 1; i <= fm.closingLine; i++) {
        const line = view.state.doc.line(i);
        if (i === 1 || i === fm.closingLine) {
          builder.add(line.from, line.from, frontmatterDelimiterDecoration);
        } else {
          builder.add(line.from, line.from, frontmatterLineDecoration);
        }
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations }
);

/**
 * Auto-fold frontmatter on first load only.
 * Tracks tab IDs that have already been auto-folded so tab switching
 * (which calls view.setState and re-creates plugins) doesn't re-fold
 * frontmatter the user manually unfolded.
 */
const autoFoldedTabs = new Set<string>();

/** Call when a tab is closed to prevent memory leaks */
export function clearAutoFoldForTab(tabId: string) {
  autoFoldedTabs.delete(tabId);
}

/**
 * The active tab ID is injected here by the Editor so the plugin knows
 * which tab is being shown. Updated before each setState call.
 */
export const frontmatterTabRef = { current: null as string | null };

const frontmatterAutoFold = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      const tabId = frontmatterTabRef.current;
      if (!tabId || autoFoldedTabs.has(tabId)) return;

      requestAnimationFrame(() => {
        const fm = findFrontmatter(view.state.doc);
        if (!fm) return;
        const firstLine = view.state.doc.line(1);
        view.dispatch({
          effects: foldEffect.of({ from: firstLine.to, to: fm.to }),
        });
        if (tabId) autoFoldedTabs.add(tabId);
      });
    }
  }
);

/** Theme for frontmatter decorations */
const frontmatterTheme = EditorView.theme({
  ".cm-frontmatter-line, .cm-frontmatter-line *": {
    color: "var(--text-tertiary) !important",
    fontFamily: "var(--font-mono) !important",
    fontSize: "0.85em !important",
    fontWeight: "normal !important",
    fontStyle: "normal !important",
    opacity: "0.8",
  },
  ".cm-frontmatter-delimiter, .cm-frontmatter-delimiter *": {
    color: "var(--text-tertiary) !important",
    fontFamily: "var(--font-mono) !important",
    fontSize: "0.85em !important",
    fontWeight: "normal !important",
    fontStyle: "normal !important",
    opacity: "0.5",
  },
  ".cm-frontmatter-folded": {
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8em",
    fontStyle: "italic",
    cursor: "pointer",
    padding: "0 4px",
  },
});

/** Command: fold frontmatter block (for command palette) */
export function foldFrontmatterCommand(view: EditorView): boolean {
  const fm = findFrontmatter(view.state.doc);
  if (!fm) return false;
  const firstLine = view.state.doc.line(1);
  view.dispatch({
    effects: foldEffect.of({ from: firstLine.to, to: fm.to }),
  });
  return true;
}

/** Command: toggle frontmatter fold/unfold */
export function toggleFrontmatterFoldCommand(view: EditorView): boolean {
  const fm = findFrontmatter(view.state.doc);
  if (!fm) return false;

  const firstLine = view.state.doc.line(1);

  // Check if frontmatter is currently folded
  let isFolded = false;
  foldedRanges(view.state).between(firstLine.from, fm.to, () => {
    isFolded = true;
  });

  if (isFolded) {
    view.dispatch({
      effects: unfoldEffect.of({ from: firstLine.to, to: fm.to }),
    });
  } else {
    view.dispatch({
      effects: foldEffect.of({ from: firstLine.to, to: fm.to }),
    });
  }
  return true;
}

/** Bundle all frontmatter extensions */
export function frontmatterExtension() {
  return [frontmatterDecorations, frontmatterAutoFold, frontmatterTheme];
}
