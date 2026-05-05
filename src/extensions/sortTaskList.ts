import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";

// Tier ranks for sorting (lower = closer to top).
const TIER_PLAIN = 0;       // bullet without checkbox
const TIER_IMPORTANT = 1;   // [!]
const TIER_TODO = 2;        // [ ]
const TIER_PARTIAL = 3;     // [/]
const TIER_SCHEDULED = 4;   // [<]
const TIER_DELEGATED = 5;   // [>]
const TIER_DONE = 6;        // [x] / [X]
const TIER_CANCELED = 7;    // [-]
const TIER_EXTRAS = 8;      // anything else

// Top-level item line: indent, marker, space, optional [c] task box.
// Capture 1 = indent, 2 = checkbox char (or undefined).
const LIST_ITEM_RE = /^(\s*)[-*+]\s+(?:\[(.)\]\s*)?/;

function checkboxTier(c: string | undefined): number {
  if (c === undefined) return TIER_PLAIN;
  switch (c) {
    case "!": return TIER_IMPORTANT;
    case " ": return TIER_TODO;
    case "/": return TIER_PARTIAL;
    case "<": return TIER_SCHEDULED;
    case ">": return TIER_DELEGATED;
    case "x":
    case "X": return TIER_DONE;
    case "-": return TIER_CANCELED;
    default:  return TIER_EXTRAS;
  }
}

interface ListInfo {
  kind: "bullet" | "ordered";
  from: number;
  to: number;
}

function findEnclosingList(state: EditorState, pos: number): ListInfo | null {
  let node: SyntaxNode | null = syntaxTree(state).resolve(pos, 0);
  while (node) {
    if (node.name === "BulletList") return { kind: "bullet", from: node.from, to: node.to };
    if (node.name === "OrderedList") return { kind: "ordered", from: node.from, to: node.to };
    node = node.parent;
  }
  return null;
}

interface Item {
  lines: string[];
  tier: number;
  origIdx: number;
}

/**
 * Sort the bullet list at the cursor by checkbox status.
 * Returns true if a sort was attempted (block was a bullet list with at least
 * one checkbox), false otherwise. A no-op on already-sorted lists still returns
 * true — the command "succeeded" semantically.
 */
export function sortTaskListAtCursor(view: EditorView): boolean {
  const state = view.state;
  const pos = state.selection.main.head;
  const list = findEnclosingList(state, pos);
  if (!list || list.kind !== "bullet") return false;

  // Preserve trailing newlines on the block as a whole (re-attached after sort).
  const text = state.doc.sliceString(list.from, list.to);
  const trailingNl = text.match(/\n*$/)![0];
  const body = text.slice(0, text.length - trailingNl.length);
  const lines = body.split("\n");

  // First top-level item's indent defines what counts as a top-level row.
  let topIndent = -1;
  for (const line of lines) {
    const m = line.match(LIST_ITEM_RE);
    if (m) { topIndent = m[1].length; break; }
  }
  if (topIndent < 0) return false;

  // Group lines into items. Each top-level item line starts a new item;
  // subsequent non-top-level lines (sub-bullets, continuation, blank) belong to it.
  const items: Item[] = [];
  let current: Item | null = null;

  for (const line of lines) {
    const m = line.match(LIST_ITEM_RE);
    if (m && m[1].length === topIndent) {
      if (current) items.push(current);
      current = { lines: [line], tier: checkboxTier(m[2]), origIdx: items.length };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) items.push(current);

  // Refuse if no item has a checkbox — not a task list.
  const hasCheckbox = items.some((it) => {
    const m = it.lines[0].match(LIST_ITEM_RE);
    return !!(m && m[2] !== undefined);
  });
  if (!hasCheckbox) return false;

  // Stable sort: tier ascending, ties broken by original index.
  items.sort((a, b) => a.tier - b.tier || a.origIdx - b.origIdx);

  const sortedText = items.map((it) => it.lines.join("\n")).join("\n") + trailingNl;
  if (sortedText === text) return true;

  view.dispatch({
    changes: { from: list.from, to: list.to, insert: sortedText },
  });
  return true;
}
