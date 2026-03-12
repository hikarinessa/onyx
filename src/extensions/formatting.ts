import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

/**
 * Wraps the current selection (or word at cursor) with the given marker.
 * If already wrapped, unwraps it. Cmd+B → **, Cmd+I → *, Cmd+Shift+C → `
 *
 * Known limitation: multi-cursor unwrap selection offsets may drift when
 * earlier changes shift positions. Single-cursor (the common case) is correct.
 */
function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];
  const selections: { anchor: number; head: number }[] = [];

  for (const range of state.selection.ranges) {
    let from = range.from;
    let to = range.to;

    // If no selection, expand to word boundaries
    if (from === to) {
      const line = state.doc.lineAt(from);
      const text = line.text;
      const col = from - line.from;
      let wStart = col;
      let wEnd = col;
      while (wStart > 0 && /\w/.test(text[wStart - 1])) wStart--;
      while (wEnd < text.length && /\w/.test(text[wEnd])) wEnd++;
      from = line.from + wStart;
      to = line.from + wEnd;
    }

    const len = marker.length;
    const before = state.doc.sliceString(Math.max(0, from - len), from);
    const after = state.doc.sliceString(to, Math.min(state.doc.length, to + len));

    if (before === marker && after === marker) {
      // Already wrapped — unwrap
      changes.push({ from: from - len, to: from, insert: "" });
      changes.push({ from: to, to: to + len, insert: "" });
      selections.push({ anchor: from - len, head: to - len });
    } else {
      // Wrap
      changes.push({ from, to: from, insert: marker });
      changes.push({ from: to, to, insert: marker });
      selections.push({ anchor: from + len, head: to + len });
    }
  }

  if (changes.length === 0) return false;

  view.dispatch({
    changes,
    selection: EditorSelection.create(
      selections.map((s) => EditorSelection.range(s.anchor, s.head))
    ),
  });
  return true;
}

export const formattingKeymap = [
  {
    key: "Mod-b",
    run: (view: EditorView) => toggleWrap(view, "**"),
  },
  {
    key: "Mod-i",
    run: (view: EditorView) => toggleWrap(view, "*"),
  },
  {
    key: "Mod-Shift-c",
    run: (view: EditorView) => toggleWrap(view, "`"),
  },
];
