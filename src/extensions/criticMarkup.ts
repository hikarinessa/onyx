/**
 * CM6: CriticMarkup review decorations.
 *
 * Everything is built from a StateField rather than a ViewPlugin. A comment body can
 * contain a newline, which makes the widget that replaces `{>>...<<}` a multi-line
 * replace decoration — and a ViewPlugin must not emit those (it drives the viewport into
 * unbounded growth). The StateField also gives the rest of the editor a place to read the
 * parsed suggestions from, which is how livePreview learns to keep its hands off them.
 */

import {
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import {
  acceptChange,
  hasCriticMarkup,
  parseCriticMarkup,
  rejectChange,
  replyChange,
  type DocChange,
  type ParseWarning,
  type Span,
  type Suggestion,
} from "../lib/criticMarkup";
import { selectActiveTab, useAppStore } from "../stores/app";
import { previewModeField, setClaimedRangesHook } from "./livePreview";

// A document with no markup at all is the common case — skip the scan entirely rather
// than running a regex over every note on every keystroke.
const hasMarkup = hasCriticMarkup;

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
const KEPT = Decoration.mark({ class: "cm-critic-kept" });

/** Review mode: the proposals are laid over the document and can be decided. */
export const toggleReviewEffect = StateEffect.define<boolean>();

export const reviewModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(toggleReviewEffect)) return e.value;
    return value;
  },
});

/** A span the parser produced can be empty; CM6 rejects a zero-length mark. */
const push = (out: Range<Decoration>[], deco: Decoration, s: Span) => {
  if (s.to > s.from) out.push(deco.range(s.from, s.to));
};

/**
 * Preview shows the document as it stands: the original text with every proposal taken
 * out of sight. Deletions and substitutions keep the text they would change, additions
 * and comments disappear entirely — the document you would have if you decided nothing.
 * As suggestions get decided in Review, this converges on the finished note.
 */
function buildPreviewProjection(review: ReviewState): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  for (const s of review.suggestions) {
    const { token, original } = s;
    if (original.to > original.from) {
      // Keep the original text, hide the markup on either side of it. The surviving text
      // also needs its own colour back: `{~~old~>new~~}` parses as a strikethrough node,
      // whose highlight style greys everything inside it, and in Preview there is no
      // proposal on screen to explain why this sentence looks dimmed.
      out.push(HIDE.range(token.from, original.from));
      out.push(KEPT.range(original.from, original.to));
      out.push(HIDE.range(original.to, token.to));
    } else {
      out.push(HIDE.range(token.from, token.to));
    }
  }
  return out;
}

function buildDecorations(state: EditorState, review: ReviewState): DecorationSet {
  if (!state.field(previewModeField)) return Decoration.none;
  if (!review.suggestions.length) return Decoration.none;

  if (!state.field(reviewModeField)) {
    const projected = buildPreviewProjection(review);
    projected.sort((a, b) => a.from - b.from || a.to - b.to);
    return Decoration.set(projected, true);
  }

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
    const modeChanged =
      tr.startState.field(previewModeField) !== tr.state.field(previewModeField) ||
      tr.startState.field(reviewModeField) !== tr.state.field(reviewModeField);
    if (!tr.docChanged && !modeChanged) return value.map(tr.changes);
    return buildDecorations(tr.state, review);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Mirrors the suggestion count into the store so the status bar and the mode cycle can
 * see it without reaching into editor state. Same shape as the lint diagnostics bridge.
 */
let lastSignature = "";

const countPublisher = EditorView.updateListener.of((update) => {
  const n = update.state.field(criticMarkupField, false)?.suggestions.length ?? 0;
  const store = useAppStore.getState();
  store.setSuggestionCount(n);

  // The card column renders from editor state rather than a copy of it, so it only needs
  // to know when to look again: the list changed, the selection moved, or the mode did.
  const signature = [
    n,
    currentSuggestion(update.state)?.id ?? "-",
    update.state.field(reviewModeField, false) ? "r" : "-",
  ].join(":");
  if (signature !== lastSignature) {
    lastSignature = signature;
    store.bumpReviewTick();
  }

  // Review retires itself. Deciding the last suggestion removes the last marker, and
  // leaving the editor in a mode with nothing left to show would just be a dead end.
  // Setting the store mode lets EditorPane dispatch it — an update listener must not.
  if (n === 0 && update.docChanged) {
    const tab = selectActiveTab(store);
    if (tab?.editorMode === "review") store.setEditorMode(tab.id, "preview");
  }
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

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

/**
 * The suggestion the keyboard is pointing at. Held as a document offset rather than an
 * id: ids are positional and every decision renumbers them, so an id would dangle the
 * moment you accepted anything. An offset survives, and the nearest suggestion at or
 * after it is a sensible place to land.
 */
export const setCursorAt = StateEffect.define<number | null>();

const reviewCursorField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setCursorAt)) return e.value;
    if (value === null) return null;
    return tr.changes.mapPos(value, 1);
  },
});

/** The suggestion the cursor points at, or the first one if it points nowhere yet. */
export function currentSuggestion(state: EditorState): Suggestion | null {
  const list = getSuggestions(state);
  if (!list.length) return null;
  const at = state.field(reviewCursorField, false) ?? null;
  if (at === null) return list[0];
  return list.find((s) => s.token.to > at) ?? list[list.length - 1];
}

export function step(state: EditorState, delta: 1 | -1): Suggestion | null {
  const list = getSuggestions(state);
  if (!list.length) return null;
  const cur = currentSuggestion(state);
  const idx = cur ? list.indexOf(cur) : -1;
  const next = Math.min(Math.max(idx + delta, 0), list.length - 1);
  return list[next];
}

const moveTo = (view: EditorView, s: Suggestion | null): boolean => {
  if (!s) return false;
  view.dispatch({
    effects: [setCursorAt.of(s.token.from), EditorView.scrollIntoView(s.token.from, { y: "center" })],
  });
  return true;
};

/** Apply a decision and leave the cursor where the suggestion was, ready for the next one. */
function decide(view: EditorView, make: (doc: string, s: Suggestion) => DocChange): boolean {
  const s = currentSuggestion(view.state);
  if (!s) return false;
  const doc = view.state.doc.toString();
  const change = make(doc, s);
  view.dispatch({ changes: change, effects: setCursorAt.of(change.from) });
  return true;
}

/** Act on a specific suggestion, for the card column where the target is whatever was clicked. */
function decideById(
  view: EditorView,
  id: string,
  make: (doc: string, s: Suggestion) => DocChange,
): boolean {
  const s = getSuggestions(view.state).find((x) => x.id === id);
  if (!s) return false;
  const change = make(view.state.doc.toString(), s);
  view.dispatch({ changes: change, effects: setCursorAt.of(change.from) });
  view.focus();
  return true;
}

export const acceptById = (view: EditorView, id: string) => decideById(view, id, acceptChange);

export const rejectById = (view: EditorView, id: string, note?: string) =>
  decideById(view, id, (d, s) => rejectChange(d, s, note));

/** Answer a comment without consuming it — both the comment and the reply reach the next pass. */
export function replyById(view: EditorView, id: string, text: string): boolean {
  const s = getSuggestions(view.state).find((x) => x.id === id);
  if (!s || !text.trim()) return false;
  const change = replyChange(s, text);
  view.dispatch({ changes: change, effects: setCursorAt.of(change.from) });
  view.focus();
  return true;
}

/** Put the keyboard cursor on a suggestion and bring it into view. */
export function selectById(view: EditorView, id: string): boolean {
  const s = getSuggestions(view.state).find((x) => x.id === id);
  if (!s) return false;
  view.dispatch({
    effects: [
      setCursorAt.of(s.token.from),
      EditorView.scrollIntoView(s.token.from, { y: "center" }),
    ],
  });
  return true;
}

export const acceptCurrent = (view: EditorView) => decide(view, acceptChange);
export const rejectCurrent = (view: EditorView) => decide(view, (d, s) => rejectChange(d, s));
export const nextSuggestion = (view: EditorView) => moveTo(view, step(view.state, 1));
export const prevSuggestion = (view: EditorView) => moveTo(view, step(view.state, -1));

/** Decide every remaining suggestion in one transaction. */
export function decideAll(view: EditorView, accept: boolean): boolean {
  const list = getSuggestions(view.state);
  if (!list.length) return false;
  const doc = view.state.doc.toString();
  const changes = list.map((s) => (accept ? acceptChange(doc, s) : rejectChange(doc, s)));
  view.dispatch({ changes, effects: setCursorAt.of(null) });
  return true;
}

/**
 * re-view's review keys. Only live in Review mode — in Preview or Source these are
 * ordinary characters, and stealing `a` from someone typing would be unforgivable.
 */
const reviewKeymap = keymap.of([
  { key: "j", run: (v) => v.state.field(reviewModeField) && nextSuggestion(v) },
  { key: "k", run: (v) => v.state.field(reviewModeField) && prevSuggestion(v) },
  { key: "a", run: (v) => v.state.field(reviewModeField) && acceptCurrent(v) },
  { key: "x", run: (v) => v.state.field(reviewModeField) && rejectCurrent(v) },
  {
    key: "Escape",
    run: (v) => {
      if (!v.state.field(reviewModeField)) return false;
      v.dispatch({ effects: setCursorAt.of(null) });
      return true;
    },
  },
]);

/** Ring around whichever suggestion the keyboard is on, so `a`/`x` are never a guess. */
const cursorHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(_value, tr) {
    if (!tr.state.field(reviewModeField)) return Decoration.none;
    const s = currentSuggestion(tr.state);
    if (!s) return Decoration.none;
    return Decoration.set([
      Decoration.mark({ class: "cm-critic-current" }).range(s.token.from, s.token.to),
    ]);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function criticMarkupExtension(): Extension[] {
  return [
    criticMarkupField,
    reviewModeField,
    reviewCursorField,
    criticDecorationField,
    cursorHighlight,
    countPublisher,
    Prec.high(reviewKeymap),
  ];
}
