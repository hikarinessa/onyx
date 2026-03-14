import {
  ViewPlugin,
  EditorView,
  type ViewUpdate,
  Decoration,
  type DecorationSet,
  GutterMarker,
  gutter,
} from "@codemirror/view";
import {
  StateField,
  StateEffect,
  RangeSetBuilder,
  type Extension,
  type EditorState,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { keymap } from "@codemirror/view";

// ── Block range detection ──

export interface BlockRange {
  from: number;
  to: number;
  firstLine: number;
  lastLine: number;
}

const BLOCK_TYPES = new Set([
  "Paragraph",
  "ATXHeading1", "ATXHeading2", "ATXHeading3",
  "ATXHeading4", "ATXHeading5", "ATXHeading6",
  "SetextHeading1", "SetextHeading2",
  "BulletList", "OrderedList",
  "FencedCode", "CodeBlock",
  "Blockquote", "Table", "HorizontalRule", "HTMLBlock",
]);

function computeBlocks(state: EditorState): BlockRange[] {
  const blocks: BlockRange[] = [];
  const doc = state.doc;
  const tree = syntaxTree(state);

  // Skip frontmatter
  let fmEndPos = 0;
  if (doc.lines >= 2 && doc.line(1).text.trim() === "---") {
    for (let j = 2; j <= doc.lines; j++) {
      if (doc.line(j).text.trim() === "---") {
        fmEndPos = doc.line(j).to;
        break;
      }
    }
  }

  tree.iterate({
    enter(node) {
      if (node.from < fmEndPos) return false;
      if (BLOCK_TYPES.has(node.name)) {
        blocks.push({
          from: node.from,
          to: node.to,
          firstLine: doc.lineAt(node.from).number,
          lastLine: doc.lineAt(node.to).number,
        });
        return false;
      }
    },
  });

  return blocks;
}

/** Find the block containing a document position. */
export function blockAt(blocks: BlockRange[], pos: number): BlockRange | null {
  for (const b of blocks) {
    if (pos >= b.from && pos <= b.to) return b;
  }
  return null;
}

/** Find the block containing a line number. */
function blockAtLine(blocks: BlockRange[], line: number): BlockRange | null {
  for (const b of blocks) {
    if (line >= b.firstLine && line <= b.lastLine) return b;
  }
  return null;
}

// ── StateField for block ranges ──

const blockRangesField = StateField.define<BlockRange[]>({
  create: computeBlocks,
  update(blocks, tr) {
    if (tr.docChanged) return computeBlocks(tr.state);
    return blocks;
  },
});

// ── Hovered block tracking ──

const setHoveredBlock = StateEffect.define<number | null>();

const hoveredBlockLine = StateField.define<number | null>({
  create: () => null,
  update(current, tr) {
    for (const e of tr.effects) {
      if (e.is(setHoveredBlock)) return e.value;
    }
    return current;
  },
});

// ── Gutter copy icon ──

class CopyMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const btn = document.createElement("div");
    btn.className = "block-copy-gutter";
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    btn.title = "Copy block";
    return btn;
  }
}

const copyMarkerInstance = new CopyMarker();

const blockGutter = gutter({
  class: "cm-block-gutter",
  markers(view) {
    const hLine = view.state.field(hoveredBlockLine);
    if (hLine === null) {
      const b = new RangeSetBuilder<GutterMarker>();
      return b.finish();
    }
    const builder = new RangeSetBuilder<GutterMarker>();
    const line = view.state.doc.line(hLine);
    builder.add(line.from, line.from, copyMarkerInstance);
    return builder.finish();
  },
  domEventHandlers: {
    click(view, line) {
      const blocks = view.state.field(blockRangesField);
      const lineNum = view.state.doc.lineAt(line.from).number;
      const block = blockAtLine(blocks, lineNum);
      if (block) {
        const text = view.state.doc.sliceString(block.from, block.to);
        navigator.clipboard.writeText(text);
        return true;
      }
      return false;
    },
  },
});

// ── Hover highlight decoration ──

const blockHighlightDeco = Decoration.line({ class: "cm-block-hover-line" });

const blockHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_, tr) {
    const hLine = tr.state.field(hoveredBlockLine);
    if (hLine === null) return Decoration.none;

    const blocks = tr.state.field(blockRangesField);
    const block = blockAtLine(blocks, hLine);
    if (!block) return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();
    const line = tr.state.doc.line(block.firstLine);
    builder.add(line.from, line.from, blockHighlightDeco);
    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Mouse tracking ViewPlugin ──

const hoverTracker = ViewPlugin.fromClass(
  class {
    view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      view.dom.addEventListener("mousemove", this.onMove);
      view.dom.addEventListener("mouseleave", this.onLeave);
    }

    onMove = (e: MouseEvent) => {
      const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return;
      const line = this.view.state.doc.lineAt(pos).number;
      const blocks = this.view.state.field(blockRangesField);
      const block = blockAtLine(blocks, line);
      const targetLine = block ? block.firstLine : null;
      if (targetLine !== this.view.state.field(hoveredBlockLine)) {
        this.view.dispatch({ effects: setHoveredBlock.of(targetLine) });
      }
    };

    onLeave = () => {
      if (this.view.state.field(hoveredBlockLine) !== null) {
        this.view.dispatch({ effects: setHoveredBlock.of(null) });
      }
    };

    destroy() {
      this.view.dom.removeEventListener("mousemove", this.onMove);
      this.view.dom.removeEventListener("mouseleave", this.onLeave);
    }

    update(_update: ViewUpdate) {}
  }
);

// ── Block move commands ──

function moveBlock(view: EditorView, direction: -1 | 1): boolean {
  const blocks = view.state.field(blockRangesField);
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const block = blockAtLine(blocks, cursorLine);
  if (!block) return false;

  const idx = blocks.indexOf(block);
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= blocks.length) return false;

  const target = blocks[targetIdx];
  const doc = view.state.doc;

  const blockText = doc.sliceString(block.from, block.to);
  const targetText = doc.sliceString(target.from, target.to);

  // Compute the full range including any separating whitespace
  let rangeFrom: number, rangeTo: number;
  let newContent: string;

  if (direction === -1) {
    // Moving up: swap target and block
    rangeFrom = target.from;
    rangeTo = block.to;
    const between = doc.sliceString(target.to, block.from);
    newContent = blockText + between + targetText;
  } else {
    // Moving down: swap block and target
    rangeFrom = block.from;
    rangeTo = target.to;
    const between = doc.sliceString(block.to, target.from);
    newContent = targetText + between + blockText;
  }

  // Calculate new cursor position
  const cursorOffset = view.state.selection.main.head - block.from;
  let newBlockStart: number;
  if (direction === -1) {
    newBlockStart = rangeFrom;
  } else {
    newBlockStart = rangeFrom + targetText.length + (doc.sliceString(block.to, target.from)).length;
  }

  view.dispatch({
    changes: { from: rangeFrom, to: rangeTo, insert: newContent },
    selection: { anchor: newBlockStart + Math.min(cursorOffset, blockText.length) },
  });

  return true;
}

// ── Block utility functions (for command palette) ──

export function copyBlock(view: EditorView): boolean {
  const blocks = view.state.field(blockRangesField);
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const block = blockAtLine(blocks, cursorLine);
  if (!block) return false;
  const text = view.state.doc.sliceString(block.from, block.to);
  navigator.clipboard.writeText(text);
  return true;
}

export function deleteBlock(view: EditorView): boolean {
  const blocks = view.state.field(blockRangesField);
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const block = blockAtLine(blocks, cursorLine);
  if (!block) return false;

  const doc = view.state.doc;
  // Include trailing newline(s) if not at end of doc
  let deleteTo = block.to;
  if (deleteTo < doc.length) {
    const nextLineStart = doc.line(block.lastLine + 1).from;
    deleteTo = nextLineStart;
  }
  // If at end, include preceding newline
  let deleteFrom = block.from;
  if (deleteFrom > 0 && deleteTo === doc.length) {
    deleteFrom = doc.line(block.firstLine).from - 1;
  }

  view.dispatch({
    changes: { from: Math.max(0, deleteFrom), to: Math.min(doc.length, deleteTo) },
  });
  return true;
}

/** Returns the current block's text and range, for use by extract-to-note. */
export function getCurrentBlock(view: EditorView): { text: string; from: number; to: number } | null {
  const blocks = view.state.field(blockRangesField);
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const block = blockAtLine(blocks, cursorLine);
  if (!block) return null;
  return {
    text: view.state.doc.sliceString(block.from, block.to),
    from: block.from,
    to: block.to,
  };
}

// ── Theme ──

const blockTheme = EditorView.theme({
  ".cm-block-gutter": {
    width: "18px",
    cursor: "default",
  },
  ".cm-block-gutter .block-copy-gutter": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    borderRadius: "3px",
    opacity: "0.6",
    transition: "opacity 0.15s, color 0.15s",
  },
  ".cm-block-gutter .block-copy-gutter:hover": {
    opacity: "1",
    color: "var(--text-primary)",
    background: "var(--bg-hover)",
  },
  ".cm-block-hover-line": {
    borderTop: "1px solid var(--border-subtle)",
  },
});

// ── Export ──

export function blocksExtension(): Extension[] {
  return [
    blockRangesField,
    hoveredBlockLine,
    blockHighlightField,
    hoverTracker,
    blockGutter,
    blockTheme,
    keymap.of([
      {
        key: "Cmd-Shift-ArrowUp",
        run: (view) => moveBlock(view, -1),
      },
      {
        key: "Cmd-Shift-ArrowDown",
        run: (view) => moveBlock(view, 1),
      },
    ]),
  ];
}
