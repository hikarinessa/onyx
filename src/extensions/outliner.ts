import { EditorView } from "@codemirror/view";
import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { foldService, indentUnit } from "@codemirror/language";

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

function isOrderedMarker(marker: string): boolean {
  return /^\d+\.$/.test(marker);
}

/** Collect changes to renumber ordered siblings at a given indent level. */
function collectRenumberChanges(
  view: EditorView, startLine: number, indent: string, startNum: number
): ChangeSpec[] {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  let num = startNum;
  for (let i = startLine; i <= state.doc.lines; i++) {
    const l = state.doc.line(i);
    const info = getListInfo(l.text);
    if (!info) break;
    if (info.indent.length < indent.length) break;
    if (info.indent.length > indent.length) continue;
    if (!isOrderedMarker(info.marker)) break;
    const newMarker = num + ".";
    if (info.marker !== newMarker) {
      const markerFrom = l.from + info.indent.length;
      changes.push({ from: markerFrom, to: markerFrom + info.marker.length, insert: newMarker });
    }
    num++;
  }
  return changes;
}

/** Find what number a new item should get at the given indent level by looking above. */
function findNextNumber(view: EditorView, aboveLine: number, indent: string): number {
  const { state } = view;
  for (let i = aboveLine; i >= 1; i--) {
    const l = state.doc.line(i);
    const info = getListInfo(l.text);
    if (!info) break;
    if (info.indent.length < indent.length) break;
    if (info.indent === indent && isOrderedMarker(info.marker)) {
      return parseInt(info.marker) + 1;
    }
  }
  return 1;
}

function indentListItem(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const info = getListInfo(line.text);
  if (!info) return false;

  const unit = state.facet(indentUnit);

  if (isOrderedMarker(info.marker)) {
    const newIndent = info.indent + unit;
    const newNum = findNextNumber(view, line.number - 1, newIndent);
    const markerEnd = line.from + info.indent.length + info.marker.length;
    const changes: ChangeSpec[] = [
      { from: line.from, to: markerEnd, insert: newIndent + newNum + "." },
      ...collectRenumberChanges(view, line.number + 1, info.indent, parseInt(info.marker)),
    ];
    view.dispatch({ changes });
  } else {
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: unit },
    });
  }
  return true;
}

function outdentListItem(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const info = getListInfo(line.text);
  if (!info || info.indent.length === 0) return false;

  const unitLen = state.facet(indentUnit).length;
  const removeChars = Math.min(unitLen, info.indent.length);

  if (isOrderedMarker(info.marker)) {
    const newIndent = info.indent.slice(removeChars);
    const newNum = findNextNumber(view, line.number - 1, newIndent);
    const markerEnd = line.from + info.indent.length + info.marker.length;
    const changes: ChangeSpec[] = [
      { from: line.from, to: markerEnd, insert: newIndent + newNum + "." },
      // Renumber old siblings at the deeper indent level
      ...collectRenumberChanges(view, line.number + 1, info.indent, parseInt(info.marker)),
      // Renumber new siblings at the shallower indent level
      ...collectRenumberChanges(view, line.number + 1, newIndent, newNum + 1),
    ];
    view.dispatch({ changes });
  } else {
    view.dispatch({
      changes: { from: line.from, to: line.from + removeChars, insert: "" },
    });
  }
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

const CHECKBOX_RE = /^(\s*)([-*+])\s\[[ x]\]\s/;

/** Cycle list type: bullet → checkbox → ordered → bullet. Non-list lines become bullets. */
function cycleListType(view: EditorView): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const { from, to } = state.selection.main;
  const startLine = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(to).number;

  // Detect type of first list line to determine cycle target
  let firstType: "bullet" | "ordered" | "checkbox" | "none" = "none";
  for (let i = startLine; i <= endLine; i++) {
    const text = state.doc.line(i).text;
    if (CHECKBOX_RE.test(text)) { firstType = "checkbox"; break; }
    const info = getListInfo(text);
    if (info) {
      firstType = isOrderedMarker(info.marker) ? "ordered" : "bullet";
      break;
    }
  }

  // Cycle: bullet → checkbox → ordered → bullet. Non-list → bullet.
  const nextType = firstType === "bullet" ? "checkbox"
    : firstType === "checkbox" ? "ordered"
    : firstType === "ordered" ? "bullet"
    : "bullet";

  let orderedNum = 1;
  for (let i = startLine; i <= endLine; i++) {
    const line = state.doc.line(i);
    const text = line.text;
    const cbMatch = text.match(CHECKBOX_RE);
    const info = getListInfo(text);

    if (!cbMatch && !info) {
      // Non-list line — convert to the target type
      const indent = text.match(/^(\s*)/)?.[1] ?? "";
      let newPrefix: string;
      if (nextType === "bullet") newPrefix = `${indent}- `;
      else if (nextType === "checkbox") newPrefix = `${indent}- [ ] `;
      else newPrefix = `${indent}${orderedNum++}. `;
      changes.push({ from: line.from, to: line.from + indent.length, insert: newPrefix });
      continue;
    }

    // Determine current prefix to replace
    const indent = cbMatch ? cbMatch[1] : info!.indent;
    const prefixEnd = cbMatch ? line.from + cbMatch[0].length : line.from + info!.fullPrefix.length;

    let newPrefix: string;
    if (nextType === "bullet") {
      newPrefix = `${indent}- `;
    } else if (nextType === "checkbox") {
      newPrefix = `${indent}- [ ] `;
    } else {
      newPrefix = `${indent}${orderedNum++}. `;
    }

    changes.push({ from: line.from, to: prefixEnd, insert: newPrefix });
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
}

export const outlinerKeymap = [
  { key: "Tab", run: indentListItem },
  { key: "Shift-Tab", run: outdentListItem },
  { key: "Ctrl-Shift-ArrowUp", mac: "Alt-ArrowUp", run: moveListItemUp },
  { key: "Ctrl-Shift-ArrowDown", mac: "Alt-ArrowDown", run: moveListItemDown },
  { key: "Enter", run: newListItem },
  { key: "Backspace", run: backspaceOnEmptyItem },
  { key: "Mod-l", run: cycleListType },
];

/**
 * List fold: collapse nested list items under their parent.
 *
 * A list item is foldable when the next line(s) are indented deeper.
 * The foldable range extends from the end of the parent line to the
 * last contiguous line that is more deeply indented (or a blank line
 * followed by more deeply indented content).
 *
 * Integrates with CM6's codeFolding() + foldGutter() via foldService.
 */

function listItemIndent(lineText: string): number | null {
  const m = lineText.match(LIST_RE);
  if (!m) return null;
  return m[1].length;
}

export function listFoldRange(
  state: EditorState,
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  const doc = state.doc;
  const line = doc.lineAt(lineStart);

  // Must be a list item
  const parentIndent = listItemIndent(line.text);
  if (parentIndent === null) return null;

  // Check that the next line exists and is more deeply indented
  if (line.number >= doc.lines) return null;
  const nextLine = doc.line(line.number + 1);
  const nextIndent = listItemIndent(nextLine.text);
  // Next line must be a list item indented deeper than parent
  if (nextIndent === null || nextIndent <= parentIndent) return null;

  // Walk forward: include all lines that are either:
  // - list items indented deeper than the parent
  // - blank lines (only if followed by deeper-indented content)
  // - non-list continuation lines indented deeper than the parent
  let lastContentLineEnd = nextLine.to;
  for (let i = line.number + 1; i <= doc.lines; i++) {
    const l = doc.line(i);
    const trimmed = l.text.trimStart();

    if (trimmed === "") {
      // Blank line — peek ahead to see if deeper content continues
      continue;
    }

    const ind = listItemIndent(l.text);
    // Non-list line: check raw indent (continuation text)
    const rawIndent = l.text.length - trimmed.length;

    if (ind !== null && ind <= parentIndent) break; // sibling or parent-level item
    if (ind === null && rawIndent <= parentIndent) break; // unindented non-list line

    lastContentLineEnd = l.to;
  }

  // Fold from end of parent line to end of last child line
  if (lastContentLineEnd <= lineEnd) return null;
  return { from: lineEnd, to: lastContentLineEnd };
}

export function listFoldExtension(): Extension {
  return foldService.of(listFoldRange);
}
