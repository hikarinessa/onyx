import { type EditorView } from "@codemirror/view";
import { type EditorState } from "@codemirror/state";
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
 */
export class CM6TextEditor extends ITextEditor {
  private changes: { from: number; to: number; insert: string }[] = [];

  constructor(private view: EditorView) {
    super();
  }

  getCursorPosition(): Point {
    const pos = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(pos);
    return new Point(line.number - 1, pos - line.from);
  }

  setCursorPosition(pos: Point): void {
    const line = this.view.state.doc.line(pos.row + 1);
    const offset = line.from + Math.min(pos.column, line.length);
    this.view.dispatch({ selection: { anchor: offset } });
  }

  setSelectionRange(range: Range): void {
    const startLine = this.view.state.doc.line(range.start.row + 1);
    const endLine = this.view.state.doc.line(range.end.row + 1);
    const anchor = startLine.from + Math.min(range.start.column, startLine.length);
    const head = endLine.from + Math.min(range.end.column, endLine.length);
    this.view.dispatch({ selection: { anchor, head } });
  }

  getLastRow(): number {
    return this.view.state.doc.lines - 1;
  }

  acceptsTableEdit(row: number): boolean {
    const lineNum = row + 1;
    if (lineNum < 1 || lineNum > this.view.state.doc.lines) return false;
    const line = this.view.state.doc.line(lineNum);
    const tree = syntaxTree(this.view.state);
    const node = tree.resolveInner(line.from);
    // Reject if inside fenced code block or frontmatter
    let cur = node;
    while (cur.parent) {
      if (cur.name === "FencedCode" || cur.name === "CodeBlock") return false;
      if (cur.name === "Frontmatter") return false;
      cur = cur.parent;
    }
    return true;
  }

  getLine(row: number): string {
    const lineNum = row + 1;
    if (lineNum < 1 || lineNum > this.view.state.doc.lines) return "";
    return this.view.state.doc.line(lineNum).text;
  }

  insertLine(row: number, line: string): void {
    const doc = this.view.state.doc;
    if (row > doc.lines - 1) {
      // Append after last line
      const lastLine = doc.line(doc.lines);
      this.view.dispatch({
        changes: { from: lastLine.to, insert: "\n" + line },
      });
    } else {
      const targetLine = doc.line(row + 1);
      this.view.dispatch({
        changes: { from: targetLine.from, insert: line + "\n" },
      });
    }
  }

  deleteLine(row: number): void {
    const doc = this.view.state.doc;
    const lineNum = row + 1;
    if (lineNum < 1 || lineNum > doc.lines) return;
    const line = doc.line(lineNum);
    if (lineNum === doc.lines) {
      // Last line: delete including preceding newline
      const from = lineNum > 1 ? doc.line(lineNum - 1).to : line.from;
      this.view.dispatch({ changes: { from, to: line.to } });
    } else {
      // Delete line including trailing newline
      this.view.dispatch({ changes: { from: line.from, to: line.to + 1 } });
    }
  }

  replaceLines(startRow: number, endRow: number, lines: string[]): void {
    const doc = this.view.state.doc;
    const fromLine = doc.line(startRow + 1);
    const toLine = doc.line(endRow + 1);
    const insert = lines.join("\n");
    this.view.dispatch({
      changes: { from: fromLine.from, to: toLine.to, insert },
    });
  }

  transact(func: () => void): void {
    func();
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
