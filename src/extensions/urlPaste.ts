import { EditorView } from "@codemirror/view";

/**
 * URL paste extension: when pasting a URL with text selected,
 * automatically creates a markdown link [selected text](url).
 */

const URL_RE = /^https?:\/\/\S+$/;

export const urlPasteExtension = EditorView.domEventHandler("paste", (event, view) => {
  const clipText = event.clipboardData?.getData("text/plain")?.trim();
  if (!clipText || !URL_RE.test(clipText)) return false;

  const { state } = view;
  const range = state.selection.main;

  // Only transform if there's a text selection
  if (range.from === range.to) return false;

  const selectedText = state.doc.sliceString(range.from, range.to);
  const replacement = `[${selectedText}](${clipText})`;

  event.preventDefault();
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: replacement },
  });
  return true;
});
