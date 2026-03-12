import { EditorState, type Extension } from "@codemirror/state";

/**
 * Shared editor state: caches and extension builder reference.
 * Split out so both Editor.tsx and EditorPane.tsx can access them.
 */

/** Full EditorState snapshots — preserves undo history, selections, etc. */
export const editorStateCache = new Map<string, EditorState>();

/** Scroll positions per tab */
export const scrollCache = new Map<string, number>();

/** Last-saved content strings — used for dirty detection */
export const lastSavedContent = new Map<string, string>();

/** Module-level reference to the shared extensions array */
export const sharedExtensionsRef = { current: null as Extension[] | null };

/** Create an EditorState with the shared extensions */
export function createStateWithExtensions(doc: string): EditorState {
  if (!sharedExtensionsRef.current) {
    return EditorState.create({ doc });
  }
  return EditorState.create({ doc, extensions: sharedExtensionsRef.current });
}
