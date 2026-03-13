import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

/**
 * Wraps the current selection (or word at cursor) with the given marker.
 * If already wrapped, unwraps it. Cmd+B → **, Cmd+I → *, Cmd+Shift+C → `
 *
 * Multi-cursor safe: processes ranges in reverse order so earlier changes
 * don't shift positions of later ranges.
 */
function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view;

  // Collect range info in forward order, then process in reverse
  const ops: {
    from: number;
    to: number;
    unwrap: boolean;
  }[] = [];

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

    ops.push({ from, to, unwrap: before === marker && after === marker });
  }

  if (ops.length === 0) return false;

  // Build changes and selections in reverse order to avoid position drift
  const changes: { from: number; to: number; insert: string }[] = [];
  const selections: { anchor: number; head: number }[] = [];

  // Track cumulative offset for selection positions
  let cumulativeOffset = 0;
  const offsets: number[] = new Array(ops.length);

  // First pass: compute offsets in forward order
  for (let i = 0; i < ops.length; i++) {
    offsets[i] = cumulativeOffset;
    const len = marker.length;
    if (ops[i].unwrap) {
      cumulativeOffset -= len * 2; // removing 2 markers
    } else {
      cumulativeOffset += len * 2; // adding 2 markers
    }
  }

  // Build changes in reverse order (rightmost first)
  for (let i = ops.length - 1; i >= 0; i--) {
    const { from, to, unwrap } = ops[i];
    const len = marker.length;
    if (unwrap) {
      changes.push({ from: to, to: to + len, insert: "" });
      changes.push({ from: from - len, to: from, insert: "" });
    } else {
      changes.push({ from: to, to: to, insert: marker });
      changes.push({ from, to: from, insert: marker });
    }
  }

  // Build selections in forward order with cumulative offsets
  for (let i = 0; i < ops.length; i++) {
    const { from, to, unwrap } = ops[i];
    const len = marker.length;
    if (unwrap) {
      selections.push({
        anchor: from - len + offsets[i],
        head: to - len + offsets[i],
      });
    } else {
      selections.push({
        anchor: from + len + offsets[i],
        head: to + len + offsets[i],
      });
    }
  }

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
