import { keymap, EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import {
  isInTable,
  createTableEditor,
  tableOptions,
} from "./tableAdapter";
import { Alignment, SortOrder } from "@tgrosinger/md-advanced-tables";

/**
 * Table editor extension — Tab/Enter navigation + auto-format.
 *
 * Delegates all table logic to md-advanced-tables via the CM6 adapter.
 * Keymap is registered before the outliner so table handlers get first shot.
 * Each handler checks isInTable() and returns false if not inside a table,
 * allowing the event to propagate to outliner/default handlers.
 */
export function tableEditorExtension(): Extension[] {
  return [
    keymap.of([
      {
        key: "Tab",
        run(view) {
          if (!isInTable(view.state)) return false;
          const te = createTableEditor(view);
          te.nextCell(tableOptions);
          return true;
        },
      },
      {
        key: "Shift-Tab",
        run(view) {
          if (!isInTable(view.state)) return false;
          const te = createTableEditor(view);
          te.previousCell(tableOptions);
          return true;
        },
      },
      {
        key: "Enter",
        run(view) {
          if (!isInTable(view.state)) return false;
          const te = createTableEditor(view);
          te.nextRow(tableOptions);
          return true;
        },
      },
      {
        key: "Escape",
        run(view) {
          if (!isInTable(view.state)) return false;
          const te = createTableEditor(view);
          te.escape(tableOptions);
          return true;
        },
      },
    ]),
    // Paste handler: detect TSV clipboard data and convert to GFM table
    EditorView.domEventHandlers({
      paste(event, view) {
        const clip = event.clipboardData;
        if (!clip) return false;

        const text = clip.getData("text/plain");
        if (!text) return false;

        // Don't intercept paste inside an existing table
        if (isInTable(view.state)) return false;

        // Detect TSV: require ≥2 columns AND ≥2 rows
        if (!isTSV(text)) return false;

        event.preventDefault();
        const table = tsvToGfmTable(text);
        const pos = view.state.selection.main.head;
        // Ensure blank line before table if not at doc start
        const line = view.state.doc.lineAt(pos);
        const prefix = line.from > 0 && line.text.trim() !== "" ? "\n\n" : line.text.trim() === "" ? "" : "\n";
        view.dispatch({
          changes: { from: pos, insert: prefix + table + "\n" },
        });
        return true;
      },
    }),
  ];
}

// ── TSV detection & conversion ──

function isTSV(text: string): boolean {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return false;
  // Check that at least 2 lines have ≥2 tab-separated columns
  let validLines = 0;
  for (const line of lines) {
    if (line.split("\t").length >= 2) validLines++;
  }
  return validLines >= 2;
}

function tsvToGfmTable(text: string): string {
  const lines = text.trim().split("\n");
  const rows = lines.map((l) => l.split("\t"));
  const colCount = Math.max(...rows.map((r) => r.length));

  // Pad rows to uniform width
  for (const row of rows) {
    while (row.length < colCount) row.push("");
  }

  const header = "| " + rows[0].join(" | ") + " |";
  const delim = "| " + rows[0].map(() => "---").join(" | ") + " |";
  const body = rows
    .slice(1)
    .map((r) => "| " + r.join(" | ") + " |")
    .join("\n");

  return header + "\n" + delim + "\n" + body;
}

// ── Command palette table commands ──

/** Run a table command on the given EditorView, if cursor is in a table. */
function runTableCmd(
  view: EditorView | null,
  fn: (te: ReturnType<typeof createTableEditor>) => void,
): void {
  if (!view) return;
  if (!isInTable(view.state)) return;
  const te = createTableEditor(view);
  fn(te);
  view.focus();
}

/**
 * Table commands for the command palette.
 * Each returns an execute() function that takes no args.
 * The getView callback defers view lookup to execution time.
 */
export function makeTableCommands(getView: () => EditorView | null) {
  return {
    insertColumnRight: () => runTableCmd(getView(), (te) => te.insertColumn(tableOptions)),
    deleteColumn: () => runTableCmd(getView(), (te) => te.deleteColumn(tableOptions)),
    insertRowBelow: () => runTableCmd(getView(), (te) => te.insertRow(tableOptions)),
    deleteRow: () => runTableCmd(getView(), (te) => te.deleteRow(tableOptions)),
    moveColumnRight: () => runTableCmd(getView(), (te) => te.moveColumn(1, tableOptions)),
    moveColumnLeft: () => runTableCmd(getView(), (te) => te.moveColumn(-1, tableOptions)),
    moveRowDown: () => runTableCmd(getView(), (te) => te.moveRow(1, tableOptions)),
    moveRowUp: () => runTableCmd(getView(), (te) => te.moveRow(-1, tableOptions)),
    alignLeft: () => runTableCmd(getView(), (te) => te.alignColumn(Alignment.LEFT, tableOptions)),
    alignCenter: () => runTableCmd(getView(), (te) => te.alignColumn(Alignment.CENTER, tableOptions)),
    alignRight: () => runTableCmd(getView(), (te) => te.alignColumn(Alignment.RIGHT, tableOptions)),
    sortAsc: () => runTableCmd(getView(), (te) => te.sortRows(SortOrder.Ascending, tableOptions)),
    sortDesc: () => runTableCmd(getView(), (te) => te.sortRows(SortOrder.Descending, tableOptions)),
    transpose: () => runTableCmd(getView(), (te) => te.transpose(tableOptions)),
    format: () => runTableCmd(getView(), (te) => te.format(tableOptions)),
    insertTable: () => {
      const view = getView();
      if (!view) return;
      const pos = view.state.selection.main.head;
      const template =
        "| Header 1 | Header 2 | Header 3 |\n" +
        "| -------- | -------- | -------- |\n" +
        "|          |          |          |";
      const line = view.state.doc.lineAt(pos);
      const prefix = line.text.trim() === "" ? "" : "\n\n";
      view.dispatch({
        changes: { from: pos, insert: prefix + template + "\n" },
        // Place cursor in first body cell (after "| " on third line)
        selection: { anchor: pos + prefix.length + template.indexOf("|          |") + 2 },
      });
      view.focus();
    },
  };
}
