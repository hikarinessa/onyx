import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

/**
 * Detects [[wikilinks]] in the editor and:
 * - Applies a styled .cm-wikilink class to the entire [[link]] span
 * - Cmd+click to follow the link via wikilinkFollowRef callback
 * - Cmd+Enter to follow the link under the cursor
 */

/** Inject a follow-link handler from the parent component */
export const wikilinkFollowRef = { current: null as ((link: string) => void) | null };

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** Build decorations by scanning all visible lines for [[...]] patterns */
function buildWikilinkDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const mark = Decoration.mark({ class: "cm-wikilink" });

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    let match: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;
    while ((match = WIKILINK_RE.exec(line.text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;
      builder.add(from, to, mark);
    }
  }

  return builder.finish();
}

/** Extract link text from the raw [[...]] match */
function extractLinkText(raw: string): string {
  return raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
}

/**
 * Check if the cursor at `pos` is inside a [[wikilink]] and return the link
 * text if so, otherwise null.
 */
function wikilinkAtPos(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos);
  const offsetInLine = pos - line.from;
  let match: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((match = WIKILINK_RE.exec(line.text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offsetInLine >= start && offsetInLine <= end) {
      return extractLinkText(match[0]);
    }
  }
  return null;
}

/** ViewPlugin that tracks and rebuilds decorations on doc changes */
const wikilinkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildWikilinkDecorations(view);
    }

    update(update: { docChanged: boolean; view: EditorView }) {
      if (update.docChanged) {
        this.decorations = buildWikilinkDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

/** DOM click handler — Cmd+click on a .cm-wikilink span follows the link */
const wikilinkClickHandler = EditorView.domEventHandlers({
  click(event, _view) {
    if (!event.metaKey) return false;
    const target = event.target as HTMLElement;
    const el =
      target.classList.contains("cm-wikilink")
        ? target
        : target.closest(".cm-wikilink");
    if (!el) return false;

    const text = el.textContent ?? "";
    const linkText = extractLinkText(text);
    if (linkText && wikilinkFollowRef.current) {
      event.preventDefault();
      wikilinkFollowRef.current(linkText);
    }
    return true;
  },
});

/** Cmd+Enter keymap — follow the wikilink under the cursor */
const wikilinkKeymap = keymap.of([
  {
    key: "Mod-Enter",
    run(view) {
      const pos = view.state.selection.main.head;
      const linkText = wikilinkAtPos(view, pos);
      if (linkText && wikilinkFollowRef.current) {
        wikilinkFollowRef.current(linkText);
        return true;
      }
      return false;
    },
  },
]);

/** Theme for wikilink decorations */
const wikilinkTheme = EditorView.theme({
  ".cm-wikilink": {
    color: "var(--link-color)",
    cursor: "pointer",
    textDecorationStyle: "dotted",
    textDecorationLine: "underline",
    textDecorationThickness: "1px",
  },
});

/** Bundle all wikilink extensions */
export function wikilinkExtension(): Extension[] {
  return [wikilinkDecorations, wikilinkClickHandler, wikilinkKeymap, wikilinkTheme];
}
