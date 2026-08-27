import type { EditorView } from "@codemirror/view";
import { getCurrentBlock } from "../extensions/blocks";
import { selectActiveTab, useAppStore } from "../stores/app";
import { createNoteWithContent } from "./fileOps";

/**
 * Move the block under the caret into a new note beside the current one, leaving a
 * wikilink in its place. Shared by the command palette and the editor's context menu.
 */
export async function extractBlockToNote(view: EditorView): Promise<void> {
  const block = getCurrentBlock(view);
  if (!block) return;
  const tab = selectActiveTab(useAppStore.getState());
  if (!tab) return;
  const dir = tab.path.substring(0, tab.path.lastIndexOf("/"));
  const firstLine = block.text.split("\n")[0].replace(/^#+\s*/, "").trim();
  const baseName = (firstLine.substring(0, 40) || "Extracted Note").replace(/[/:\0]/g, "");
  // All file mutations go through fileOps (see docs/GUIDELINES.md)
  const notePath = await createNoteWithContent(dir, baseName, block.text + "\n");
  const linkName = notePath.split("/").pop()!.replace(".md", "");
  view.dispatch({
    changes: { from: block.from, to: block.to, insert: `[[${linkName}]]` },
  });
}
