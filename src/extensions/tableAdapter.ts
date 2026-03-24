import { type EditorView } from "@codemirror/view";
import { type EditorState, type ChangeSpec, ChangeSet, EditorSelection, type Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  ITextEditor,
  Point,
  Range,
  TableEditor,
  type Options,
  optionsWithDefaults,
  FormatType,
} from "@tgrosinger/md-advanced-tables";

/**
 * CM6 adapter for md-advanced-tables.
 *
 * The library uses 0-indexed rows/columns.
 * CM6 uses 1-indexed line numbers (doc.line(1) is the first line).
 * All conversions happen here.
 *
 * transact() batches all mutations into a single CM6 dispatch so that
 * edit-script operations (sequential insert/delete) don't invalidate
 * each other's row references.
 */
export class CM6TextEditor extends ITextEditor {
  view: EditorView;
  private _inTransaction = false;
  private _txDoc: Text | null = null;
  private _txComposed: ChangeSet | null = null;
  private _txSelection: { anchor: number; head: number } | null = null;

  constructor(view: EditorView) {
    super();
    this.view = view;
  }

  /** Current document — either the transaction-in-progress doc or the real doc. */
  private get doc(): Text {
    return this._txDoc ?? this.view.state.doc;
  }

  getCursorPosition(): Point {
    const pos = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(pos);
    return new Point(line.number - 1, pos - line.from);
  }

  setCursorPosition(pos: Point): void {
    const d = this.doc;
    const line = d.line(pos.row + 1);
    const offset = line.from + Math.min(pos.column, line.length);
    if (this._inTransaction) {
      this._txSelection = { anchor: offset, head: offset };
    } else {
      this.view.dispatch({ selection: { anchor: offset } });
    }
  }

  setSelectionRange(range: Range): void {
    const d = this.doc;
    const startLine = d.line(range.start.row + 1);
    const endLine = d.line(range.end.row + 1);
    const anchor = startLine.from + Math.min(range.start.column, startLine.length);
    const head = endLine.from + Math.min(range.end.column, endLine.length);
    if (this._inTransaction) {
      this._txSelection = { anchor, head };
    } else {
      this.view.dispatch({ selection: { anchor, head } });
    }
  }

  getLastRow(): number {
    return this.doc.lines - 1;
  }

  acceptsTableEdit(row: number): boolean {
    const lineNum = row + 1;
    if (lineNum < 1 || lineNum > this.view.state.doc.lines) return false;
    const line = this.view.state.doc.line(lineNum);
    const tree = syntaxTree(this.view.state);
    const node = tree.resolveInner(line.from);
    let cur = node;
    while (cur.parent) {
      if (cur.name === "FencedCode" || cur.name === "CodeBlock") return false;
      if (cur.name === "Frontmatter") return false;
      cur = cur.parent;
    }
    return true;
  }

  getLine(row: number): string {
    const d = this.doc;
    const lineNum = row + 1;
    if (lineNum < 1 || lineNum > d.lines) return "";
    return d.line(lineNum).text;
  }

  /** Apply a change — either immediately or batched into the current transaction. */
  private applyChange(change: ChangeSpec): void {
    if (this._inTransaction) {
      // Build a ChangeSet against the current transaction doc, then compose
      const cs = ChangeSet.of(change, this._txDoc!.length);
      this._txComposed = this._txComposed!.compose(cs);
      // Update the transaction doc so subsequent reads see the new state
      this._txDoc = cs.apply(this._txDoc!);
    } else {
      this.view.dispatch({ changes: change });
    }
  }

  insertLine(row: number, line: string): void {
    const d = this.doc;
    if (row > d.lines - 1) {
      const lastLine = d.line(d.lines);
      this.applyChange({ from: lastLine.to, insert: "\n" + line });
    } else {
      const targetLine = d.line(row + 1);
      this.applyChange({ from: targetLine.from, insert: line + "\n" });
    }
  }

  deleteLine(row: number): void {
    const d = this.doc;
    const lineNum = row + 1;
    if (lineNum < 1 || lineNum > d.lines) return;
    const line = d.line(lineNum);
    if (lineNum === d.lines) {
      const from = lineNum > 1 ? d.line(lineNum - 1).to : line.from;
      this.applyChange({ from, to: line.to });
    } else {
      this.applyChange({ from: line.from, to: line.to + 1 });
    }
  }

  replaceLines(startRow: number, endRow: number, lines: string[]): void {
    const d = this.doc;
    const fromLine = d.line(startRow + 1);
    const toLine = d.line(endRow + 1);
    const insert = lines.join("\n");
    this.applyChange({ from: fromLine.from, to: toLine.to, insert });
  }

  transact(func: () => void): void {
    const origDoc = this.view.state.doc;
    this._inTransaction = true;
    this._txDoc = origDoc;
    this._txComposed = ChangeSet.empty(origDoc.length);
    this._txSelection = null;
    try {
      func();
      const composed = this._txComposed!;
      const sel = this._txSelection as { anchor: number; head: number } | null;
      if (!composed.empty) {
        if (sel) {
          this.view.dispatch({
            changes: composed,
            selection: EditorSelection.create([EditorSelection.range(sel.anchor, sel.head)]),
          });
        } else {
          this.view.dispatch({ changes: composed });
        }
      } else if (sel) {
        this.view.dispatch({
          selection: EditorSelection.create([EditorSelection.range(sel.anchor, sel.head)]),
        });
      }
    } finally {
      this._inTransaction = false;
      this._txDoc = null;
      this._txComposed = null;
      this._txSelection = null;
    }
  }
}

/**
 * Check if a position is inside a Table node in the Lezer syntax tree.
 */
export function isInTable(state: EditorState): boolean {
  const pos = state.selection.main.head;
  const tree = syntaxTree(state);
  let node = tree.resolveInner(pos);
  while (node) {
    if (node.name === "Table") return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}

/**
 * Find the Table node containing `pos`, if any.
 * Returns the range (from, to) in the document.
 */
export function findTableRange(
  state: EditorState,
  pos: number,
): { from: number; to: number } | null {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(pos);
  while (node) {
    if (node.name === "Table") {
      return { from: node.from, to: node.to };
    }
    if (!node.parent) break;
    node = node.parent;
  }
  return null;
}

/**
 * Find all Table nodes overlapping a range.
 */
export function findTablesInRange(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number }[] {
  const tables: { from: number; to: number }[] = [];
  const tree = syntaxTree(state);
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name === "Table") {
        tables.push({ from: node.from, to: node.to });
        return false; // don't descend into table children
      }
    },
  });
  return tables;
}

/** Default options for table operations. */
export const tableOptions: Options = optionsWithDefaults({
  formatType: FormatType.NORMAL,
  smartCursor: true,
});

/** Create a TableEditor wrapping a CM6 view. */
export function createTableEditor(view: EditorView): TableEditor {
  return new TableEditor(new CM6TextEditor(view));
}
