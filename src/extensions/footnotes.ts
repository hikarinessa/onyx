/**
 * CM6: footnotes.
 *
 * In Preview, a `[^label]` reference becomes its superscript number, and the `[^label]:`
 * marker of its definition becomes the same number, so the two can be matched by eye.
 * Like the rest of live preview, the line holding the cursor shows its raw syntax so the
 * markers can be edited.
 * Hovering a reference shows the footnote text in either mode. Clicking a reference
 * moves the caret to its definition; clicking a definition's number moves it back to the
 * first reference. The clicks themselves are dispatched from wikilinks.ts, which owns all
 * link-like click handling — this module supplies the targets.
 *
 * Parsed from a StateField because numbering depends on the whole document: a reference
 * at the top of the viewport can take its number from a label first used off screen.
 */

import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  hoverTooltip,
  type DecorationSet,
} from "@codemirror/view";
import {
  EMPTY_FOOTNOTES,
  hasFootnotes,
  parseFootnotes,
  type FootnoteDefinition,
  type FootnoteReference,
  type Footnotes,
} from "../lib/footnotes";
import { previewModeField } from "./livePreview";

export const footnotesField = StateField.define<Footnotes>({
  create: (state) => parseFootnotes(state.doc.toString()),
  update(value, tr) {
    if (!tr.docChanged) return value;
    const text = tr.newDoc.toString();
    return hasFootnotes(text) ? parseFootnotes(text) : EMPTY_FOOTNOTES;
  },
});

class FootnoteNumberWidget extends WidgetType {
  readonly number: number;
  readonly label: string;
  readonly role: "ref" | "def";

  constructor(number: number, label: string, role: "ref" | "def") {
    super();
    this.number = number;
    this.label = label;
    this.role = role;
  }

  eq(other: FootnoteNumberWidget) {
    return other.number === this.number && other.label === this.label && other.role === this.role;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = this.role === "ref" ? "cm-footnote-ref" : "cm-footnote-def";
    // wikilinks.ts reads these to route the click.
    if (this.role === "ref") el.dataset.footnoteRef = this.label;
    else el.dataset.footnoteDef = this.label;
    el.textContent = String(this.number);
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * `[^1]: text` is also valid link-reference syntax, so the markdown grammar colours a
 * one-word footnote as a URL. The body is prose; this puts its colour back.
 */
const BODY = Decoration.mark({ class: "cm-footnote-body" });

const cursorLine = (state: EditorState) => state.doc.lineAt(state.selection.main.head).number;

function buildDecorations(state: EditorState): DecorationSet {
  if (!state.field(previewModeField)) return Decoration.none;
  const { references, definitions } = state.field(footnotesField);
  const { doc } = state;
  const focus = cursorLine(state);
  const onFocusLine = (pos: number) => doc.lineAt(pos).number === focus;
  const out: Range<Decoration>[] = [];

  for (const r of references) {
    if (!r.number || onFocusLine(r.token.from)) continue;
    out.push(
      Decoration.replace({
        widget: new FootnoteNumberWidget(r.number, r.label, "ref"),
        inclusiveEnd: false,
      }).range(r.token.from, r.token.to),
    );
  }
  for (const d of definitions) {
    if (!d.number || onFocusLine(d.marker.from)) continue;
    out.push(
      Decoration.replace({
        widget: new FootnoteNumberWidget(d.number, d.label, "def"),
        inclusiveEnd: false,
      }).range(d.marker.from, d.marker.to),
    );
    const firstLineEnd = doc.lineAt(d.marker.from).to;
    if (firstLineEnd > d.body.from) out.push(BODY.range(d.body.from, firstLineEnd));
  }

  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(out, true);
}

export const footnoteDecorationField = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(value, tr) {
    const modeChanged = tr.startState.field(previewModeField) !== tr.state.field(previewModeField);
    const focusMoved = !!tr.selection && cursorLine(tr.startState) !== cursorLine(tr.state);
    if (!tr.docChanged && !modeChanged && !focusMoved) return value;
    return buildDecorations(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Lookup ──

const definitionOf = (state: EditorState, label: string): FootnoteDefinition | undefined =>
  state.field(footnotesField, false)?.definitions.find((d) => d.label === label && d.number > 0);

const firstReferenceTo = (state: EditorState, label: string): FootnoteReference | undefined =>
  state.field(footnotesField, false)?.references.find((r) => r.label === label && r.number > 0);

/**
 * The numbered reference touching `pos`. A widget boundary reports the position on either
 * side of it, so `side` says which way the pointer leans: at `token.from` it must lean
 * right into the token, at `token.to` left.
 */
export function referenceAt(state: EditorState, pos: number, side = 0): FootnoteReference | undefined {
  return state.field(footnotesField, false)?.references.find(
    (r) =>
      r.number > 0 &&
      pos >= r.token.from &&
      pos <= r.token.to &&
      !(pos === r.token.from && side < 0) &&
      !(pos === r.token.to && side > 0),
  );
}

/** The definition whose marker is at `pos`, counting the start of its body — where a jump lands. */
function definitionMarkerAt(state: EditorState, pos: number): FootnoteDefinition | undefined {
  return state.field(footnotesField, false)?.definitions.find(
    (d) => d.number > 0 && pos >= d.marker.from && pos <= Math.max(d.marker.to, d.body.from),
  );
}

// ── Navigation ──

const moveCaret = (view: EditorView, anchor: number): boolean => {
  view.dispatch({
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: "center" }),
  });
  view.focus();
  return true;
};

/** Move the caret to the start of a footnote's text. */
export function jumpToDefinition(view: EditorView, label: string): boolean {
  const d = definitionOf(view.state, label);
  return d ? moveCaret(view, d.body.from) : false;
}

/** Move the caret to just after the first reference to a footnote. */
export function jumpToReference(view: EditorView, label: string): boolean {
  const r = firstReferenceTo(view.state, label);
  return r ? moveCaret(view, r.token.to) : false;
}

/** Follow whatever footnote syntax sits at `pos`: a reference goes down, a definition marker back up. */
export function followFootnoteAt(view: EditorView, pos: number): boolean {
  const ref = referenceAt(view.state, pos);
  if (ref) return jumpToDefinition(view, ref.label);
  const def = definitionMarkerAt(view.state, pos);
  if (def) return jumpToReference(view, def.label);
  return false;
}

// ── Hover ──

const footnoteHover = hoverTooltip((view, pos, side) => {
  const ref = referenceAt(view.state, pos, side);
  if (!ref) return null;
  const def = definitionOf(view.state, ref.label);
  if (!def) return null;
  return {
    pos: ref.token.from,
    end: ref.token.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-footnote-tooltip";
      const num = document.createElement("span");
      num.className = "cm-footnote-tooltip-number";
      num.textContent = String(def.number);
      dom.append(num, document.createTextNode(def.text || "(empty footnote)"));
      return { dom };
    },
  };
});

export function footnotesExtension(): Extension[] {
  return [footnotesField, footnoteDecorationField, footnoteHover];
}
