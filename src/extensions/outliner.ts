import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

/**
 * Outliner keybindings for list editing:
 * - Tab / Shift+Tab: indent / outdent list items
 * - Alt+Up / Alt+Down: move list items up / down
 * - Enter at end of list item: create new item
 * - Backspace on empty list item: outdent or remove marker
 */

const LIST_RE = /^(\s*)([-*+]|\d+\.)\s/;

function getListInfo(lineText: string) {
  const match = lineText.match(LIST_RE);
  if (!match) return null;
  return {
    indent: match[1],
    marker: match[2],
    fullPrefix: match[0],
  };
}

function indentListItem(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const info = getListInfo(line.text);
  if (!info) return false;

  view.dispatch({
    changes: { from: line.from, to: line.from, insert: "  " },
  });
  return true;
}

function outdentListItem(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const info = getListInfo(line.text);
  if (!info || info.indent.length === 0) return false;

  const removeChars = Math.min(2, info.indent.length);
  view.dispatch({
    changes: { from: line.from, to: line.from + removeChars, insert: "" },
  });
  return true;
}

function moveListItemUp(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  if (line.number <= 1) return false;

  if (!getListInfo(line.text)) return false;

  const prevLine = state.doc.line(line.number - 1);
  const lineText = line.text;
  const prevText = prevLine.text;

  view.dispatch({
    changes: [
      { from: prevLine.from, to: line.to, insert: lineText + "\n" + prevText },
    ],
    selection: EditorSelection.cursor(
      prevLine.from + (state.selection.main.head - line.from)
    ),
  });
  return true;
}

function moveListItemDown(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  if (line.number >= state.doc.lines) return false;

  if (!getListInfo(line.text)) return false;

  const nextLine = state.doc.line(line.number + 1);
  const lineText = line.text;
  const nextText = nextLine.text;

  view.dispatch({
    changes: [
      { from: line.from, to: nextLine.to, insert: nextText + "\n" + lineText },
    ],
    selection: EditorSelection.cursor(
      line.from + nextText.length + 1 + (state.selection.main.head - line.from)
    ),
  });
  return true;
}

function newListItem(view: EditorView): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const info = getListInfo(line.text);
  if (!info) return false;

  // If cursor is not at end of line, let default Enter handle it
  if (pos !== line.to) return false;

  // If the current item is empty (just the marker), remove the marker
  const contentAfterPrefix = line.text.slice(info.fullPrefix.length).trim();
  if (contentAfterPrefix === "") {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
    });
    return true;
  }

  // Create new list item with same indent and marker style
  let newMarker = info.marker;
  // Increment numbered lists
  const numMatch = newMarker.match(/^(\d+)\.$/);
  if (numMatch) {
    newMarker = (parseInt(numMatch[1]) + 1) + ".";
  }

  const insertion = "\n" + info.indent + newMarker + " ";
  view.dispatch({
    changes: { from: pos, to: pos, insert: insertion },
    selection: EditorSelection.cursor(pos + insertion.length),
  });
  return true;
}

function backspaceOnEmptyItem(view: EditorView): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const info = getListInfo(line.text);
  if (!info) return false;

  // Only handle if cursor is right after the prefix and content is empty
  const contentAfterPrefix = line.text.slice(info.fullPrefix.length).trim();
  if (contentAfterPrefix !== "") return false;
  if (pos !== line.from + info.fullPrefix.length) return false;

  // If indented, outdent
  if (info.indent.length > 0) {
    return outdentListItem(view);
  }

  // Otherwise, remove the marker entirely
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: "" },
    selection: EditorSelection.cursor(line.from),
  });
  return true;
}

export const outlinerKeymap = [
  { key: "Tab", run: indentListItem },
  { key: "Shift-Tab", run: outdentListItem },
  { key: "Alt-ArrowUp", run: moveListItemUp },
  { key: "Alt-ArrowDown", run: moveListItemDown },
  { key: "Enter", run: newListItem },
  { key: "Backspace", run: backspaceOnEmptyItem },
];
