import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { previewModeField } from "./livePreview";
import { followFootnoteAt, jumpToDefinition, jumpToReference } from "./footnotes";
import { useAppStore } from "../stores/app";

/**
 * Link handling: wikilinks + URLs, plus footnote jumps within the note.
 *
 * Owns ALL click dispatch for link-like elements. Uses posAtCoords + regex
 * against the document text — never DOM classes or textContent (CM6's syntax
 * highlighting splits text into opaque spans that don't reliably expose
 * decoration classes).
 *
 * The livePreview plugin handles visual concerns only (hiding syntax, styling).
 */

/** Inject a follow-link handler from the parent component.
 *  newTab: true = open in new tab, false = replace current tab
 *  otherPane: true = open in the other pane (Cmd+Shift+Click) */
export const wikilinkFollowRef = { current: null as ((link: string, newTab: boolean, otherPane: boolean) => void) | null };

// ── Regexes ──

const WIKILINK_RE = /(?<!!)\[\[([^\]]+)\]\]/g;
const BARE_URL_RE = /(?<![(\[])https?:\/\/[^\s<>\[\])(]+(?:\([^\s<>]*\))*[^\s<>\[\])("',.:;!?]/g;
// Not after "!": `![alt](url)` is an image (extensions/images.ts)
const MD_LINK_RE = /(?<!!)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

// ── Decoration builder ──

/** Build decorations by scanning visible lines for [[wikilinks]], [md](links), and bare URLs */
function buildLinkDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const wikiMark = Decoration.mark({ class: "cm-wikilink" });
  const urlMark = Decoration.mark({ class: "cm-url" });

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;
    for (let i = startLine; i <= endLine; i++) {
      const line = doc.line(i);
      const ranges: { from: number; to: number; mark: Decoration }[] = [];
      let match: RegExpExecArray | null;

      // Wikilinks
      WIKILINK_RE.lastIndex = 0;
      while ((match = WIKILINK_RE.exec(line.text)) !== null) {
        ranges.push({ from: line.from + match.index, to: line.from + match.index + match[0].length, mark: wikiMark });
      }

      // Markdown links [text](url)
      MD_LINK_RE.lastIndex = 0;
      while ((match = MD_LINK_RE.exec(line.text)) !== null) {
        const mFrom = line.from + match.index;
        const mTo = mFrom + match[0].length;
        if (!ranges.some(r => mFrom < r.to && mTo > r.from)) {
          ranges.push({ from: mFrom, to: mTo, mark: urlMark });
        }
      }

      // Bare URLs
      BARE_URL_RE.lastIndex = 0;
      while ((match = BARE_URL_RE.exec(line.text)) !== null) {
        const mFrom = line.from + match.index;
        const mTo = mFrom + match[0].length;
        if (!ranges.some(r => mFrom < r.to && mTo > r.from)) {
          ranges.push({ from: mFrom, to: mTo, mark: urlMark });
        }
      }

      ranges.sort((a, b) => a.from - b.from);
      for (const r of ranges) {
        builder.add(r.from, r.to, r.mark);
      }
    }
  }

  return builder.finish();
}

// ── Position-based link extraction ──

/** Extract link text from the raw [[...]] match */
function extractLinkText(raw: string): string {
  return raw.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
}

/** Check if pos is inside a [[wikilink]], return link text or null */
function wikilinkAtPos(doc: { lineAt(pos: number): { from: number; text: string } }, pos: number): string | null {
  const line = doc.lineAt(pos);
  const offset = pos - line.from;
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(line.text)) !== null) {
    if (offset >= m.index && offset < m.index + m[0].length) return extractLinkText(m[0]);
  }
  return null;
}

// Same shape as the tag highlighter and the preview chips: `#` at line start or after
// whitespace, then a letter.
const TAG_AT_RE = /(?<=^|\s)#([a-zA-Z][\w/-]*)/g;

/** The tag (without `#`) whose text covers pos, or null. */
export function tagAtPos(doc: { lineAt(pos: number): { from: number; text: string } }, pos: number): string | null {
  const line = doc.lineAt(pos);
  const offset = pos - line.from;
  TAG_AT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_AT_RE.exec(line.text)) !== null) {
    if (offset >= m.index && offset < m.index + m[0].length) return m[1];
  }
  return null;
}

const searchTag = (tag: string) => useAppStore.getState().searchFor(`#${tag}`);

/** Check if pos is inside a URL (markdown link or bare), return URL or null */
function urlAtPos(doc: { lineAt(pos: number): { from: number; text: string } }, pos: number): string | null {
  const line = doc.lineAt(pos);
  const offset = pos - line.from;
  let m: RegExpExecArray | null;

  // Markdown links first — return the href, not display text
  MD_LINK_RE.lastIndex = 0;
  while ((m = MD_LINK_RE.exec(line.text)) !== null) {
    if (offset >= m.index && offset < m.index + m[0].length) return m[2];
  }

  // Bare URLs
  BARE_URL_RE.lastIndex = 0;
  while ((m = BARE_URL_RE.exec(line.text)) !== null) {
    if (offset >= m.index && offset < m.index + m[0].length) return m[0];
  }

  return null;
}

// ── Open external URL ──

async function openExternalUrl(url: string) {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  openUrl(url);
}

// ── ViewPlugin ──

const linkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLinkDecorations(view);
    }

    update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildLinkDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

// ── Click dispatch ──
//
// Single handler, priority chain: footnote → wikilink → URL → tag (searches for it).
// mousedown for preview mode (before CM6 moves cursor).
// click for source mode (Cmd+click only).
// All extraction via posAtCoords + regex against document text.

const linkClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    // Preview mode only: single click follows wikilinks, opens URLs
    if (!view.state.field(previewModeField)) return false;
    const target = event.target as HTMLElement;

    // A click on an image goes to the editor, which shows its syntax for editing; its
    // URL is not a link to follow.
    if (target.closest(".cm-image-embed")) return false;

    // 1. Replace widget (MdLinkWidget): read URL from data attribute
    const urlEl = target.closest("[data-url]") as HTMLElement | null;
    if (urlEl?.dataset.url) {
      event.preventDefault();
      openExternalUrl(urlEl.dataset.url);
      return true;
    }

    // Footnote number widgets: a reference goes to its definition, a definition's number
    // back to the first reference.
    const footnoteEl = target.closest("[data-footnote-ref], [data-footnote-def]") as HTMLElement | null;
    if (footnoteEl) {
      const { footnoteRef, footnoteDef } = footnoteEl.dataset;
      const moved = footnoteRef
        ? jumpToDefinition(view, footnoteRef)
        : footnoteDef
          ? jumpToReference(view, footnoteDef)
          : false;
      if (moved) event.preventDefault();
      return moved;
    }

    // Tag chip widgets carry their tag. A plain primary click only: right-click and
    // Ctrl-click (the macOS context-menu click) keep their menu.
    const tagEl = target.closest("[data-tag]") as HTMLElement | null;
    if (tagEl?.dataset.tag && event.button === 0 && !event.ctrlKey) {
      event.preventDefault();
      searchTag(tagEl.dataset.tag);
      return true;
    }

    // 2. Regular text: posAtCoords + regex against document text
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    // Ignore clicks in empty space past line end
    const coords = view.coordsAtPos(pos);
    if (coords && event.clientX > coords.right + 2) return false;

    const linkText = wikilinkAtPos(view.state.doc, pos);
    if (linkText && wikilinkFollowRef.current) {
      event.preventDefault();
      wikilinkFollowRef.current(linkText, event.metaKey, event.metaKey && event.shiftKey);
      return true;
    }

    const url = urlAtPos(view.state.doc, pos);
    if (url) {
      event.preventDefault();
      openExternalUrl(url);
      return true;
    }

    // Raw `#tag` text is left alone here: in preview it only shows on the cursor's line,
    // where a click means "edit this". The chip branch above handles rendered tags.

    return false;
  },

  click(event, view) {
    // Source mode: Cmd+click only
    if (!event.metaKey) return false;
    // A tag chip already ran its search on mousedown
    if ((event.target as HTMLElement).closest("[data-tag]")) return true;

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;

    // Footnote?
    if (followFootnoteAt(view, pos)) {
      event.preventDefault();
      return true;
    }

    // Wikilink?
    const linkText = wikilinkAtPos(view.state.doc, pos);
    if (linkText && wikilinkFollowRef.current) {
      event.preventDefault();
      wikilinkFollowRef.current(linkText, true, event.shiftKey);
      return true;
    }

    // URL?
    const url = urlAtPos(view.state.doc, pos);
    if (url) {
      event.preventDefault();
      openExternalUrl(url);
      return true;
    }

    const tag = tagAtPos(view.state.doc, pos);
    if (tag) {
      event.preventDefault();
      searchTag(tag);
      return true;
    }

    return false;
  },
});

/** Cmd+Enter keymap — follow footnote or wikilink, open URL, or search tag, under cursor */
const linkKeymap = keymap.of([
  {
    key: "Mod-Enter",
    run(view) {
      const pos = view.state.selection.main.head;

      if (followFootnoteAt(view, pos)) return true;

      const linkText = wikilinkAtPos(view.state.doc, pos);
      if (linkText && wikilinkFollowRef.current) {
        wikilinkFollowRef.current(linkText, false, false);
        return true;
      }

      const url = urlAtPos(view.state.doc, pos);
      if (url) {
        openExternalUrl(url);
        return true;
      }

      const tag = tagAtPos(view.state.doc, pos);
      if (tag) {
        searchTag(tag);
        return true;
      }

      return false;
    },
  },
]);

// ── Theme ──

const linkTheme = EditorView.theme({
  ".cm-wikilink": {
    color: "var(--link-color)",
    cursor: "pointer",
    textDecorationStyle: "dotted",
    textDecorationLine: "underline",
    textDecorationThickness: "1px",
  },
  ".cm-url": {
    color: "var(--link-color)",
    cursor: "pointer",
    textDecorationStyle: "dotted",
    textDecorationLine: "underline",
    textDecorationThickness: "1px",
  },
});

// ── Export ──

export function wikilinkExtension(): Extension[] {
  return [linkDecorations, linkClickHandler, linkKeymap, linkTheme];
}
