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

/** Inject a follow-link handler from the parent component.
 *  newTab: true = open in new tab, false = replace current tab
 *  otherPane: true = open in the other pane (Cmd+Shift+Click) */
export const wikilinkFollowRef = { current: null as ((link: string, newTab: boolean, otherPane: boolean) => void) | null };

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** Build decorations by scanning only visible lines for [[...]] patterns */
function buildWikilinkDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const mark = Decoration.mark({ class: "cm-wikilink" });

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;
    for (let i = startLine; i <= endLine; i++) {
      const line = doc.line(i);
      let match: RegExpExecArray | null;
      WIKILINK_RE.lastIndex = 0;
      while ((match = WIKILINK_RE.exec(line.text)) !== null) {
        const mFrom = line.from + match.index;
        const mTo = mFrom + match[0].length;
        builder.add(mFrom, mTo, mark);
      }
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

    update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildWikilinkDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

/**
 * DOM event handlers for wikilinks.
 *
 * Preview mode (.cm-preview-wikilink): mousedown to catch before CM6 moves
 * the cursor (which would remove the decoration on the focus line).
 * Source mode (.cm-wikilink): Cmd+click only.
 */
const wikilinkClickHandler = EditorView.domEventHandlers({
  mousedown(event, _view) {
    const target = event.target as HTMLElement;
    const el = target.closest(".cm-preview-wikilink");
    if (!el) return false;

    const text = el.textContent ?? "";
    const linkText = text.trim();
    if (linkText && wikilinkFollowRef.current) {
      event.preventDefault();
      wikilinkFollowRef.current(linkText, event.metaKey, event.metaKey && event.shiftKey);
    }
    return true;
  },
  click(event, _view) {
    if (!event.metaKey) return false;
    const target = event.target as HTMLElement;
    const el = target.closest(".cm-wikilink");
    if (!el) return false;

    const text = el.textContent ?? "";
    const linkText = extractLinkText(text);
    if (linkText && wikilinkFollowRef.current) {
      event.preventDefault();
      wikilinkFollowRef.current(linkText, true, event.shiftKey);
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
        wikilinkFollowRef.current(linkText, false, false);
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
