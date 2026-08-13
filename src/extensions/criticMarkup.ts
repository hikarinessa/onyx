/**
 * CM6: CriticMarkup review decorations.
 *
 * Everything is built from a StateField rather than a ViewPlugin. A comment body can
 * contain a newline, which makes the widget that replaces `{>>...<<}` a multi-line
 * replace decoration — and a ViewPlugin must not emit those (it drives the viewport into
 * unbounded growth). The StateField also gives the rest of the editor a place to read the
 * parsed suggestions from, which is how livePreview learns to keep its hands off them.
 */

import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import {
  parseCriticMarkup,
  type ParseWarning,
  type Span,
  type Suggestion,
} from "../lib/criticMarkup";
import { previewModeField, setClaimedRangesHook } from "./livePreview";

// A document with no markup at all is the common case — skip the scan entirely rather
// than running a regex over every note on every keystroke.
const MARKERS = ["{--", "{++", "{~~", "{==", "{>>"];
const hasMarkup = (text: string) => MARKERS.some((m) => text.includes(m));

export interface ReviewState {
  suggestions: Suggestion[];
  warnings: ParseWarning[];
  /** Token spans, so other extensions can avoid decorating inside a construct. */
  claimed: Span[];
}

const EMPTY: ReviewState = { suggestions: [], warnings: [], claimed: [] };

/** Marks the position of a comment that has no highlighted text of its own. */
class CommentMarkerWidget extends WidgetType {
  readonly id: string;
  readonly body: string;

  constructor(id: string, body: string) {
    super();
    this.id = id;
    this.body = body;
  }

  eq(other: CommentMarkerWidget) {
    return other.id === this.id && other.body === this.body;
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-critic-marker";
    el.dataset.suggestion = this.id;
    el.title = this.body;
    el.textContent = "✦";
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

const HIDE = Decoration.replace({});
const DEL = Decoration.mark({ class: "cm-critic-del" });
const INS = Decoration.mark({ class: "cm-critic-ins" });
const HIGHLIGHT = Decoration.mark({ class: "cm-critic-highlight" });

/** A span the parser produced can be empty; CM6 rejects a zero-length mark. */
const push = (out: Range<Decoration>[], deco: Decoration, s: Span) => {
  if (s.to > s.from) out.push(deco.range(s.from, s.to));
};

function buildDecorations(state: EditorState, review: ReviewState): DecorationSet {
  if (!state.field(previewModeField)) return Decoration.none;
  const doc = state.doc.toString();
  const out: Range<Decoration>[] = [];

  for (const s of review.suggestions) {
    const { token } = s;

    switch (s.type) {
      case "deletion":
        out.push(HIDE.range(token.from, s.original.from));
        push(out, DEL, s.original);
        out.push(HIDE.range(s.original.to, token.to));
        break;

      case "addition":
        out.push(HIDE.range(token.from, s.replacement!.from));
        push(out, INS, s.replacement!);
        out.push(HIDE.range(s.replacement!.to, token.to));
        break;

      case "substitution": {
        // Block-level syntax inside a substitution needs no special case. A token starts
        // mid-line with `{`, and livePreview only renders a heading or a bullet when the
        // *line* opens with one — so `### A heading` inside a proposal stays literal text
        // on its own. The two competing block structures the design worried about never
        // materialise, and hiding the delimiters here is what keeps the review readable.
        out.push(HIDE.range(token.from, s.original.from));
        push(out, DEL, s.original);
        out.push(HIDE.range(s.original.to, s.replacement!.from)); // the ~> separator
        push(out, INS, s.replacement!);
        out.push(HIDE.range(s.replacement!.to, token.to));
        break;
      }

      case "comment": {
        const body = s.comment ? doc.slice(s.comment.from, s.comment.to) : "";
        const anchored = s.original.to > s.original.from;
        if (anchored) {
          out.push(HIDE.range(token.from, s.original.from));
          push(out, HIGHLIGHT, s.original);
          // A bare highlight has nothing to say, so it gets no marker to say it with —
          // the highlight itself already carries the whole meaning.
          out.push(
            body
              ? Decoration.replace({
                  widget: new CommentMarkerWidget(s.id, body),
                  inclusiveEnd: false,
                }).range(s.original.to, token.to)
              : HIDE.range(s.original.to, token.to),
          );
        } else {
          out.push(
            Decoration.replace({
              widget: new CommentMarkerWidget(s.id, body),
              inclusiveEnd: false,
            }).range(token.from, token.to),
          );
        }
        break;
      }
    }
  }

  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(out, true);
}

/** Parsed review state for the current document. Recomputed only when the text changes. */
export const criticMarkupField = StateField.define<ReviewState>({
  create(state) {
    const text = state.doc.toString();
    if (!hasMarkup(text)) return EMPTY;
    const { suggestions, warnings } = parseCriticMarkup(text);
    return { suggestions, warnings, claimed: suggestions.map((s) => s.token) };
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    const text = tr.newDoc.toString();
    if (!hasMarkup(text)) return EMPTY;
    const { suggestions, warnings } = parseCriticMarkup(text);
    return { suggestions, warnings, claimed: suggestions.map((s) => s.token) };
  },
});

export const criticDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state, state.field(criticMarkupField));
  },
  update(value, tr) {
    const review = tr.state.field(criticMarkupField);
    const previewChanged =
      tr.startState.field(previewModeField) !== tr.state.field(previewModeField);
    if (!tr.docChanged && !previewChanged) return value.map(tr.changes);
    return buildDecorations(tr.state, review);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Suggestions in the document, in document order. Empty when there are none. */
export const getSuggestions = (state: EditorState): Suggestion[] =>
  state.field(criticMarkupField, false)?.suggestions ?? [];

/** Token spans, for extensions that must not decorate inside a construct. */
export const getClaimedRanges = (state: EditorState): Span[] =>
  state.field(criticMarkupField, false)?.claimed ?? [];

// livePreview asks for these while building its own decorations; registering the lookup
// keeps the import one-directional.
setClaimedRangesHook(getClaimedRanges);

export function criticMarkupExtension(): Extension[] {
  return [criticMarkupField, criticDecorationField];
}
