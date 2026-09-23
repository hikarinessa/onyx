/**
 * Images in live preview: `![[photo.png]]` and `![alt](url)` render as the image,
 * inline, wherever they sit on a line (their own line, a list item, side by side, after
 * text). The line holding the cursor shows the raw syntax for editing, as everywhere
 * else in preview. Code spans and blocks are left alone. Resolution and loading live in
 * lib/imageRefs.ts; tables render their cells' images through the same helper.
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { previewModeField, togglePreviewEffect } from "./livePreview";
import { useAppStore, selectActiveTabPath } from "../stores/app";
import {
  MD_IMAGE_RE,
  WIKI_IMAGE_RE,
  createImageElement,
  parseSize,
  splitAlt,
  type ImageSize,
} from "../lib/imageRefs";

/**
 * Built image elements, by widget identity. CM6 redraws a line from scratch when other
 * decorations on it change (the block hover highlight does, on every mouse move), and
 * asks the widget for a fresh element each time. Handing back the loaded element that
 * was just detached keeps the picture on screen instead of reloading it.
 */
const builtElements = new Map<string, HTMLElement>();

class ImageWidget extends WidgetType {
  readonly reference: string;
  readonly contextPath: string;
  readonly alt: string;
  readonly size: ImageSize | null;

  constructor(reference: string, contextPath: string, alt: string, size: ImageSize | null) {
    super();
    this.reference = reference;
    this.contextPath = contextPath;
    this.alt = alt;
    this.size = size;
  }

  eq(other: ImageWidget): boolean {
    return other.reference === this.reference &&
      other.contextPath === this.contextPath &&
      other.alt === this.alt &&
      other.size?.width === this.size?.width &&
      other.size?.height === this.size?.height;
  }

  private get key(): string {
    return [this.contextPath, this.reference, this.alt, this.size?.width ?? "", this.size?.height ?? ""].join("\u0000");
  }

  toDOM(view: EditorView): HTMLElement {
    const existing = builtElements.get(this.key);
    // Reuse only an element that is off screen: the same image twice needs two
    if (existing && !existing.isConnected) return existing;
    // A loaded image changes its line's height; CM6 must re-measure to keep the cursor
    // and scroll positions right.
    const dom = createImageElement(this.reference, this.contextPath, this.alt, this.size, () => view.requestMeasure());
    builtElements.set(this.key, dom);
    return dom;
  }

  /** Let a click reach the editor, which puts the cursor on the line and shows the syntax. */
  ignoreEvent(): boolean {
    return false;
  }
}

function inCode(view: EditorView, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
    if (/Code/.test(node.name)) return true;
  }
  return false;
}

function buildImageDecos(view: EditorView): DecorationSet {
  if (!view.state.field(previewModeField)) return Decoration.none;
  const contextPath = selectActiveTabPath(useAppStore.getState()) || "";
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const found: { from: number; to: number; widget: ImageWidget }[] = [];

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number === cursorLine || !line.text.includes("![")) continue;
      // Tables render their own cells (livePreview's table widget)
      if (/^\s*\|/.test(line.text)) continue;

      for (const m of line.text.matchAll(WIKI_IMAGE_RE)) {
        const at = line.from + m.index;
        if (inCode(view, at)) continue;
        const size = parseSize(m[2]);
        const alt = size ? "" : (m[2] ?? "");
        found.push({ from: at, to: at + m[0].length, widget: new ImageWidget(m[1], contextPath, alt, size) });
      }
      for (const m of line.text.matchAll(MD_IMAGE_RE)) {
        const at = line.from + m.index;
        if (inCode(view, at)) continue;
        const { alt, size } = splitAlt(m[1]);
        found.push({ from: at, to: at + m[0].length, widget: new ImageWidget(m[2], contextPath, alt, size) });
      }
    }
  }

  found.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const { from, to, widget } of found) {
    if (from < last) continue; // overlapping matches: keep the first
    builder.add(from, to, Decoration.replace({ widget }));
    last = to;
  }
  return builder.finish();
}

const imagePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildImageDecos(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(togglePreviewEffect)))
      ) {
        this.decorations = buildImageDecos(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const imageTheme = EditorView.baseTheme({
  ".cm-image-embed": {
    display: "inline-block",
    maxWidth: "100%",
    verticalAlign: "bottom",
  },
  ".cm-image-embed img": {
    display: "block",
    maxWidth: "100%",
    height: "auto",
    borderRadius: "4px",
  },
  ".cm-image-embed-missing": {
    color: "var(--text-tertiary)",
    fontStyle: "italic",
    fontSize: "0.9em",
  },
});

export function imageExtension(): Extension {
  return [imagePlugin, imageTheme];
}
