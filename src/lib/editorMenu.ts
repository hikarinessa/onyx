import type { EditorView } from "@codemirror/view";
import type { MenuItem, MenuSection } from "../components/ContextMenu";
import { copyBlock, deleteBlock, getCurrentBlock } from "../extensions/blocks";
import { sortTaskListAtCursor } from "../extensions/sortTaskList";
import { toggleBold, toggleInlineCode, toggleItalic } from "../extensions/formatting";
import { reviewModeField } from "../extensions/criticMarkup";
import {
  proposeComment,
  proposeDeletion,
  proposeInsertion,
  proposeReplacement,
} from "./criticMarkup";

/**
 * What the editor's right-click menu offers at a given click. Everything is a predicate
 * on the editor state at that moment — a selection, a list line, review mode — so the
 * menu is short in plain prose and grows only where more applies.
 */

const CHECKBOX_LINE = /^\s*[-*+]\s\[[^\]]\]\s/;
const LIST_LINE = /^\s*(?:[-*+]|\d+\.)\s/;

/** Extend a click-with-no-selection to the word under the caret. */
function wordAt(view: EditorView, pos: number): { from: number; to: number } | null {
  const w = view.state.wordAt(pos);
  return w ? { from: w.from, to: w.to } : null;
}

export function editorMenuSections(view: EditorView, extractBlock: () => void): MenuSection[] {
  const { state } = view;
  const sel = state.selection.main;
  const hasSelection = !sel.empty;
  const line = state.doc.lineAt(sel.head);
  const inReview = state.field(reviewModeField, false) ?? false;

  const target = hasSelection ? { from: sel.from, to: sel.to } : wordAt(view, sel.head);
  const targetLabel = hasSelection ? "selection" : "word";

  const dispatch = (change: { from: number; to: number; insert: string }) => {
    view.dispatch({ changes: change, selection: { anchor: change.from } });
    view.focus();
  };

  // ── Suggest ──
  // Hand-written suggestions stay pending like an LLM's, so they are reviewable and the
  // next annotation pass reads them as instructions. Writing one is a choice to have it
  // reviewed; someone who just wants the text changed would type.
  const suggest: MenuSection = {
    id: "suggest",
    items: [
      {
        id: "suggest.comment",
        label: target ? `Comment on ${targetLabel}…` : "Comment here…",
        prompt: "What should the next pass know?",
        run: (text) => {
          const doc = state.doc.toString();
          const r = target ?? { from: sel.head, to: sel.head };
          dispatch(proposeComment(doc, r.from, r.to, text ?? ""));
        },
      },
      ...(target
        ? ([
            {
              id: "suggest.delete",
              label: `Suggest deleting ${targetLabel}`,
              run: () => dispatch(proposeDeletion(state.doc.toString(), target.from, target.to)),
            },
            {
              id: "suggest.replace",
              label: `Suggest replacing ${targetLabel}…`,
              prompt: "Replacement text",
              run: (text) =>
                dispatch(proposeReplacement(state.doc.toString(), target.from, target.to, text ?? "")),
            },
            {
              id: "suggest.insert",
              label: `Suggest inserting after ${targetLabel}…`,
              prompt: "Text to insert",
              run: (text) => dispatch(proposeInsertion(target.to, text ?? "")),
            },
          ] satisfies MenuItem[])
        : ([
            {
              id: "suggest.insert",
              label: "Suggest inserting here…",
              prompt: "Text to insert",
              run: (text) => dispatch(proposeInsertion(sel.head, text ?? "")),
            },
          ] satisfies MenuItem[])),
    ],
  };

  // ── Format ──
  const format: MenuSection = {
    id: "format",
    items: [
      { id: "format.bold", label: "Bold", shortcut: "⌘B", run: () => toggleBold(view) },
      { id: "format.italic", label: "Italic", shortcut: "⌘I", run: () => toggleItalic(view) },
      { id: "format.code", label: "Inline Code", shortcut: "⇧⌘C", run: () => toggleInlineCode(view) },
    ],
  };

  // ── Block ──
  const block: MenuSection = {
    id: "block",
    items: getCurrentBlock(view)
      ? [
          { id: "block.copy", label: "Copy Block", run: () => copyBlock(view) },
          { id: "block.extract", label: "Extract Block to Note…", run: extractBlock },
          ...(CHECKBOX_LINE.test(line.text) || LIST_LINE.test(line.text)
            ? [{ id: "block.sort", label: "Sort Task List by Status", run: () => sortTaskListAtCursor(view) }]
            : []),
          { id: "block.delete", label: "Delete Block", destructive: true, run: () => deleteBlock(view) },
        ]
      : [],
  };

  // ── Clipboard ──
  const clipboard: MenuSection = {
    id: "clipboard",
    items: [
      { id: "clip.cut", label: "Cut", shortcut: "⌘X", disabled: !hasSelection, run: () => document.execCommand("cut") },
      { id: "clip.copy", label: "Copy", shortcut: "⌘C", disabled: !hasSelection, run: () => document.execCommand("copy") },
      { id: "clip.paste", label: "Paste", shortcut: "⌘V", run: () => document.execCommand("paste") },
    ],
  };

  // In Review the note is under review, so suggesting leads. Elsewhere it is still
  // available — a user can start a conversation with the next pass from any mode.
  return inReview ? [suggest, format, block, clipboard] : [format, suggest, block, clipboard];
}
