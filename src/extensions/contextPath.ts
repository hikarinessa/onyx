import { Facet, type EditorState } from "@codemirror/state";
import { useAppStore, selectActiveTabPath } from "../stores/app";

/**
 * The file a view's links resolve from. Note editors leave it unset and resolve from the
 * active tab. A card on a canvas sets it to the note the card shows (or to the canvas for
 * a text card), since the active tab there is the canvas, not the note.
 */
export const contextPathFacet = Facet.define<string, string | null>({
  combine: (values) => values[0] ?? null,
});

export function contextPathOf(state: EditorState): string {
  return state.facet(contextPathFacet) ?? selectActiveTabPath(useAppStore.getState()) ?? "";
}

/**
 * The line whose markdown Preview shows raw, for editing: the cursor's. A read-only view
 * (a canvas card, the theme preview) is never being edited, so it reveals no line.
 */
export function revealedLine(state: EditorState): number {
  return state.readOnly ? -1 : state.doc.lineAt(state.selection.main.head).number;
}
