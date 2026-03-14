import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

/**
 * When text is selected and the user types a bracket/quote character,
 * wrap the selection instead of replacing it.
 *
 * Supports single-char pairs: ( ) [ ] { } ` " '
 * For bold/wikilinks, use Cmd+B and Cmd+K respectively.
 */

const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "`": "`",
  '"': '"',
  "'": "'",
  "_": "_",
  "*": "*",
  "=": "=",
  "~": "~",
};

export function symbolWrapExtension(): Extension {
  return EditorView.inputHandler.of((view, _from, _to, insert) => {
    // Only act when there's a selection
    const { state } = view;
    const hasSelection = state.selection.ranges.some((r) => r.from !== r.to);
    if (!hasSelection) return false;

    if (!(insert in PAIRS)) return false;

    const close = PAIRS[insert];
    const changes: { from: number; to: number; insert: string }[] = [];
    const selections: { anchor: number; head: number }[] = [];
    let offset = 0;

    for (const range of state.selection.ranges) {
      if (range.from === range.to) continue;
      const text = state.doc.sliceString(range.from, range.to);
      const wrapped = insert + text + close;
      changes.push({ from: range.from, to: range.to, insert: wrapped });
      const newFrom = range.from + 1 + offset;
      const newTo = newFrom + text.length;
      selections.push({ anchor: newFrom, head: newTo });
      offset += 2; // added open + close chars
    }

    if (changes.length === 0) return false;

    view.dispatch({
      changes,
      selection: EditorSelection.create(
        selections.map((s) => EditorSelection.range(s.anchor, s.head))
      ),
    });
    return true;
  });
}
