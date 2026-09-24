/**
 * Inline HTML in live preview (lib/inlineHtml.ts): coloured `<font>`/`<span>`, `<br>`,
 * `<u>`, `<sup>`, links and the like render as formatted text. Each balanced element on
 * a line becomes a widget; the line holding the cursor shows the raw HTML for editing,
 * code is left alone, and table rows render their cells themselves.
 */
import { revealedLine } from "./contextPath";
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
import { findHtmlSegments, renderHtmlSnippet } from "../lib/inlineHtml";

class HtmlWidget extends WidgetType {
  readonly html: string;

  constructor(html: string) {
    super();
    this.html = html;
  }

  eq(other: HtmlWidget): boolean {
    return other.html === this.html;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-html-inline";
    wrap.appendChild(renderHtmlSnippet(this.html));
    return wrap;
  }

  /** Let clicks through: links open via the click dispatcher, text clicks place the cursor. */
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

function buildHtmlDecos(view: EditorView): DecorationSet {
  if (!view.state.field(previewModeField)) return Decoration.none;
  const cursorLine = revealedLine(view.state);
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number === cursorLine || !line.text.includes("<")) continue;
      if (/^\s*\|/.test(line.text)) continue; // table rows: livePreview's table widget
      for (const seg of findHtmlSegments(line.text)) {
        const at = line.from + seg.from;
        if (inCode(view, at)) continue;
        builder.add(at, line.from + seg.to, Decoration.replace({
          widget: new HtmlWidget(line.text.slice(seg.from, seg.to)),
        }));
      }
    }
  }
  return builder.finish();
}

const htmlPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildHtmlDecos(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(togglePreviewEffect)))
      ) {
        this.decorations = buildHtmlDecos(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const htmlTheme = EditorView.baseTheme({
  ".cm-html-mono": {
    fontFamily: "var(--font-mono)",
  },
  ".cm-html-inline p": {
    display: "inline",
    margin: "0",
  },
});

export function htmlInlineExtension(): Extension {
  return [htmlPlugin, htmlTheme];
}
