import type { EditorView } from "@codemirror/view";
import type { MenuItem, MenuSection } from "../components/ContextMenu";
import { copyBlock, deleteBlock, getCurrentBlock } from "../extensions/blocks";
import { sortTaskListAtCursor } from "../extensions/sortTaskList";
import { toggleBold, toggleInlineCode, toggleItalic } from "../extensions/formatting";
import { getClaimedRanges, getSuggestions, reviewModeField } from "../extensions/criticMarkup";
import { useAppStore } from "../stores/app";
import { attachedRationales } from "./criticMarkup";
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
  // A highlighted selection is its own label; a word under a bare caret is not visible
  // as a target, so the menu names it.
  const on = hasSelection ? "" : " on word";
  const noun = hasSelection ? "" : " word";

  // The parser does not nest. A suggestion written inside an existing construct is read
  // as part of that construct's text, and deciding the outer one either swallows the
  // inner or leaves its markers behind as garbage. So authoring is refused wherever the
  // target — or the caret, for a point insertion — touches a claimed range.
  //
  // An edit and the rationale comments flush against it are one span for this purpose.
  // Rationales attach by adjacency, so an insertion at the seam between them would cut
  // the chain and re-attach the LLM's reasoning to the user's suggestion instead.
  const suggestions = getSuggestions(state);
  const chains = attachedRationales(suggestions);
  const claimed = getClaimedRanges(state).map((c) => ({ ...c }));
  for (const [editId, chain] of chains) {
    const edit = suggestions.find((x) => x.id === editId);
    const span = claimed.find((c) => c.from === edit?.token.from);
    if (span) span.to = Math.max(span.to, chain[chain.length - 1].token.to);
  }
  const touchesClaimed = (from: number, to: number) =>
    from === to
      ? claimed.some((c) => from > c.from && from < c.to)
      : claimed.some((c) => from < c.to && to > c.from);
  const blocked = target ? touchesClaimed(target.from, target.to) : touchesClaimed(sel.head, sel.head);

  // Items run after the menu was built, and the editor stays live in between: the menu
  // takes focus so CodeMirror's keymaps are off, but that is a courtesy, not a guarantee.
  // Every offset here indexes into the document as it was at right-click, so a dispatch
  // against a changed document is refused rather than applied to the wrong text.
  const dispatch = (change: { from: number; to: number; insert: string }) => {
    if (!view.state.doc.eq(state.doc)) {
      useAppStore.getState().setStatusNotice("Document changed — menu action cancelled");
      view.focus();
      return;
    }
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
        label: target ? `Comment${on}…` : "Comment here…",
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
              label: `Suggest deleting${noun}`,
              run: () => dispatch(proposeDeletion(state.doc.toString(), target.from, target.to)),
            },
            {
              id: "suggest.replace",
              label: `Suggest replacing${noun}…`,
              prompt: "Replacement text",
              run: (text) =>
                dispatch(proposeReplacement(state.doc.toString(), target.from, target.to, text ?? "")),
            },
            {
              id: "suggest.insert",
              label: `Suggest inserting after ${hasSelection ? "selection" : "word"}…`,
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
  const notice = (msg: string) => useAppStore.getState().setStatusNotice(msg);
  const clipboard: MenuSection = {
    id: "clipboard",
    items: [
      {
        id: "clip.cut",
        label: "Cut",
        shortcut: "⌘X",
        disabled: !hasSelection,
        // The write settles before the delete, so a rejected write leaves the text where
        // it was rather than gone with nothing on the clipboard to show for it.
        run: () => {
          navigator.clipboard
            .writeText(selectedText())
            .then(() => dispatch({ from: sel.from, to: sel.to, insert: "" }))
            .catch(() => {
              notice("Cut failed — clipboard unavailable");
              view.focus();
            });
        },
      },
      {
        id: "clip.copy",
        label: "Copy",
        shortcut: "⌘C",
        disabled: !hasSelection,
        run: () => {
          navigator.clipboard
            .writeText(selectedText())
            .catch(() => notice("Copy failed — clipboard unavailable"))
            .finally(() => view.focus());
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
              if (!view.state.doc.eq(state.doc)) {
                notice("Document changed — paste cancelled");
                return;
              }
              view.dispatch(view.state.replaceSelection(text));
            })
            .catch(() => notice("Paste failed — clipboard read not permitted here; use ⌘V"))
            .finally(() => view.focus());
        },
      },
    ],
  };

  // In Review the note is under review, so suggesting leads. Elsewhere it is still
  // available — a user can start a conversation with the next pass from any mode.
  return inReview ? [suggest, format, block, clipboard] : [format, suggest, block, clipboard];
}
