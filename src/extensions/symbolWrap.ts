import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

/**
 * When text is selected and the user types a bracket/quote character,
 * wrap the selection instead of replacing it.
 *
 * Supports single-char pairs: ( ) [ ] { } ` " '
 * Double-char detection: [[ → [[ ]], ** → ** **, == → == ==
 */

const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "`": "`",
  '"': '"',
  "'": "'",
};

const DOUBLE_PAIRS: Record<string, string> = {
  "[": "]]",
  "*": "**",
  "=": "==",
};

export function symbolWrapExtension(): Extension {
  return EditorView.inputHandler.of((view, from, to, insert) => {
    // Only act when there's a selection
    const { state } = view;
    const hasSelection = state.selection.ranges.some((r) => r.from !== r.to);
    if (!hasSelection) return false;

    // Check for double-char pairs first
    if (insert in DOUBLE_PAIRS) {
      // Look at what's just before cursor in each range to detect double-type
      const firstRange = state.selection.ranges[0];
      const charBefore = firstRange.from > 0
        ? state.doc.sliceString(firstRange.from - 1, firstRange.from)
        : "";

      if (charBefore === insert && insert in DOUBLE_PAIRS) {
        // Double-char: e.g. user typed [ and char before selection is [
        // We need to remove the previous char and wrap with double pair
        const open = insert + insert;
        const close = DOUBLE_PAIRS[insert];
        const changes: { from: number; to: number; insert: string }[] = [];
        const selections: { anchor: number; head: number }[] = [];
        let offset = 0;

        for (const range of state.selection.ranges) {
          if (range.from === range.to) continue;
          // Remove the char before (the first of the pair)
          changes.push({ from: range.from - 1, to: range.from, insert: open });
          changes.push({ from: range.to, to: range.to, insert: " " + close });
          const newFrom = range.from - 1 + open.length + offset;
          const newTo = newFrom + (range.to - range.from);
          selections.push({ anchor: newFrom, head: newTo });
          offset += open.length - 1 + 1 + close.length;
        }

        if (changes.length > 0) {
          view.dispatch({
            changes,
            selection: EditorSelection.create(
              selections.map((s) => EditorSelection.range(s.anchor, s.head))
            ),
          });
          return true;
        }
      }
    }

    // Single-char pairs
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
