import type { EditorView } from "@codemirror/view";
import type { MenuItem, MenuSection } from "../components/ContextMenu";
import { copyBlock, deleteBlock, getCurrentBlock } from "../extensions/blocks";
import { sortTaskListAtCursor } from "../extensions/sortTaskList";
import { toggleBold, toggleInlineCode, toggleItalic } from "../extensions/formatting";
import { getClaimedRanges, reviewModeField } from "../extensions/criticMarkup";
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

// Sort acts on bullet lists only, and only sorts anything when checkboxes are present.
// Offering it anywhere else is a button that does nothing.
const CHECKBOX_BULLET = /^\s*[-*+]\s\[[^\]]\]\s/;

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

  // The parser does not nest. A suggestion written inside an existing construct is read
  // as part of that construct's text, and deciding the outer one either swallows the
  // inner or leaves its markers behind as garbage. So authoring is refused wherever the
  // target — or the caret, for a point insertion — touches a claimed range.
  const claimed = getClaimedRanges(state);
  const touchesClaimed = (from: number, to: number) =>
    claimed.some((c) => from < c.to && to > c.from) ||
    claimed.some((c) => from === to && from > c.from && from < c.to);
  const blocked = target ? touchesClaimed(target.from, target.to) : touchesClaimed(sel.head, sel.head);

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
    items: blocked
      ? [
          {
            id: "suggest.blocked",
            label: "Inside an existing suggestion",
            disabled: true,
            run: () => {},
          },
        ]
      : [
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
              prompt: "Text to insert (include any leading space)",
              run: (text) => dispatch(proposeInsertion(target.to, text ?? "")),
            },
          ] satisfies MenuItem[])
        : ([
            {
              id: "suggest.insert",
              label: "Suggest inserting here…",
              prompt: "Text to insert (include any leading space)",
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
          ...(CHECKBOX_BULLET.test(line.text)
            ? [{ id: "block.sort", label: "Sort Task List by Status", run: () => sortTaskListAtCursor(view) }]
            : []),
          { id: "block.delete", label: "Delete Block", destructive: true, run: () => deleteBlock(view) },
        ]
      : [],
  };

  // ── Clipboard ──
  // Done through the editor state and the async clipboard API rather than execCommand,
  // which only acts on the focused editable and the menu has taken focus from it.
  const selectedText = () => state.sliceDoc(sel.from, sel.to);
  const clipboard: MenuSection = {
    id: "clipboard",
    items: [
      {
        id: "clip.cut",
        label: "Cut",
        shortcut: "⌘X",
        disabled: !hasSelection,
        run: () => {
          void navigator.clipboard.writeText(selectedText());
          view.dispatch({ changes: { from: sel.from, to: sel.to, insert: "" } });
          view.focus();
        },
      },
      {
        id: "clip.copy",
        label: "Copy",
        shortcut: "⌘C",
        disabled: !hasSelection,
        run: () => {
          void navigator.clipboard.writeText(selectedText());
          view.focus();
        },
      },
      {
        id: "clip.paste",
        label: "Paste",
        shortcut: "⌘V",
        run: () => {
          navigator.clipboard
            .readText()
            .then((text) => {
              view.dispatch(view.state.replaceSelection(text));
              view.focus();
            })
            .catch(() => view.focus());
        },
      },
    ],
  };

  // In Review the note is under review, so suggesting leads. Elsewhere it is still
  // available — a user can start a conversation with the next pass from any mode.
  return inReview ? [suggest, format, block, clipboard] : [format, suggest, block, clipboard];
}
