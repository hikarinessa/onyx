import { foldService } from "@codemirror/language";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

/**
 * Heading fold: collapse content under a heading until the next heading
 * of equal or higher level (or end of document).
 *
 * Registers via CM6's foldService — integrates automatically with the
 * existing codeFolding() + foldGutter() setup in Editor.tsx.
 */

const HEADING_NODES: Record<string, number> = {
  ATXHeading1: 1, ATXHeading2: 2, ATXHeading3: 3,
  ATXHeading4: 4, ATXHeading5: 5, ATXHeading6: 6,
  SetextHeading1: 1, SetextHeading2: 2,
};

export function headingFoldRange(state: EditorState, lineStart: number, _lineEnd: number): { from: number; to: number } | null {
  const tree = syntaxTree(state);
  const doc = state.doc;

  // Check if this line starts a heading
  let headingLevel = 0;
  let headingEnd = 0;

  tree.iterate({
    from: lineStart,
    to: doc.lineAt(lineStart).to,
    enter(node) {
      const level = HEADING_NODES[node.name];
      if (level) {
        headingLevel = level;
        headingEnd = node.to;
        return false;
      }
    },
  });

  if (!headingLevel) return null;

  // Find the next heading of equal or higher level
  let foldEnd = doc.length;
  let found = false;

  tree.iterate({
    from: headingEnd + 1,
    enter(node) {
      if (found) return false;
      const level = HEADING_NODES[node.name];
      if (level && level <= headingLevel) {
        // Fold ends at the line before this heading starts
        const prevLineEnd = doc.lineAt(node.from).from;
        foldEnd = prevLineEnd > 0 ? prevLineEnd - 1 : prevLineEnd;
        found = true;
        return false;
      }
    },
  });

  // Nothing to fold if heading is at end with no content after it
  if (foldEnd <= headingEnd) return null;

  // Fold from end of heading line to end of section
  return { from: headingEnd, to: foldEnd };
}

export function headingFoldExtension(): Extension {
  return foldService.of(headingFoldRange);
}
