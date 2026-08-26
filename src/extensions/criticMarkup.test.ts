import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  criticDecorationField,
  criticMarkupExtension,
  currentSuggestion,
  getClaimedRanges,
  getSuggestions,
  step,
  toggleReviewEffect,
} from "./criticMarkup";
import { previewModeField, togglePreviewEffect } from "./livePreview";

/**
 * Decorations are built by a StateField, so they can be checked without a DOM — a widget
 * only touches `document` when it renders. This is the difference between "the extension
 * typechecks" and "the extension puts decorations at the right offsets".
 */
type Mode = "source" | "preview" | "review";

function stateFor(doc: string, mode: Mode = "review"): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [previewModeField, criticMarkupExtension()],
  });
  if (mode === "source") return state;
  return state.update({
    effects: [togglePreviewEffect.of(true), toggleReviewEffect.of(mode === "review")],
  }).state;
}

interface Deco {
  from: number;
  to: number;
  cls: string | null;
  widget: boolean;
}

function decorations(doc: string, mode: Mode = "review"): Deco[] {
  const set = stateFor(doc, mode).field(criticDecorationField);
  const out: Deco[] = [];
  const iter = set.iter();
  while (iter.value) {
    const spec = iter.value.spec as { class?: string; widget?: unknown };
    out.push({
      from: iter.from,
      to: iter.to,
      cls: spec.class ?? null,
      widget: spec.widget !== undefined && spec.widget !== null,
    });
    iter.next();
  }
  return out;
}

const textOf = (doc: string, d: Deco) => doc.slice(d.from, d.to);

describe("criticMarkupField", () => {
  it("parses suggestions out of the document", () => {
    const state = stateFor("a {--bad --}day and {++more++}");
    expect(getSuggestions(state).map((s) => s.type)).toEqual(["deletion", "addition"]);
  });

  it("exposes token spans as claimed ranges for livePreview", () => {
    const doc = "we {~~ship~>release~~} it";
    const claimed = getClaimedRanges(stateFor(doc));
    expect(claimed).toHaveLength(1);
    expect(doc.slice(claimed[0].from, claimed[0].to)).toBe("{~~ship~>release~~}");
  });

  it("claims nothing in a document whose only ==/~~ are ordinary markdown", () => {
    // The case that makes the interop necessary: these must stay livePreview's business.
    const state = stateFor("Plain ==a highlight== and ~~a strike~~.");
    expect(getSuggestions(state)).toEqual([]);
    expect(getClaimedRanges(state)).toEqual([]);
  });

  it("reparses when the document changes", () => {
    let state = stateFor("clean");
    expect(getSuggestions(state)).toEqual([]);
    state = state.update({ changes: { from: 5, insert: " {++added++}" } }).state;
    expect(getSuggestions(state).map((s) => s.type)).toEqual(["addition"]);
  });
});

describe("decorations", () => {
  it("hides a deletion's markers and marks its text", () => {
    const doc = "a {--bad --}day";
    const d = decorations(doc);
    expect(d.map((x) => [textOf(doc, x), x.cls])).toEqual([
      ["{--", null],
      ["bad ", "cm-critic-del"],
      ["--}", null],
    ]);
  });

  it("hides an addition's markers and marks its text", () => {
    const doc = "a day{++ indeed++}";
    const d = decorations(doc);
    expect(d.map((x) => [textOf(doc, x), x.cls])).toEqual([
      ["{++", null],
      [" indeed", "cm-critic-ins"],
      ["++}", null],
    ]);
  });

  it("marks both halves of a substitution and hides the separator", () => {
    const doc = "we {~~ship~>release~~} it";
    const d = decorations(doc);
    expect(d.map((x) => [textOf(doc, x), x.cls])).toEqual([
      ["{~~", null],
      ["ship", "cm-critic-del"],
      ["~>", null],
      ["release", "cm-critic-ins"],
      ["~~}", null],
    ]);
  });

  it("hides the delimiters even when the halves carry block syntax", () => {
    // The `###` stays literal because livePreview only renders a heading when the line
    // opens with one, and this line opens with `{`. No special case needed.
    const doc = "{~~### Old heading~>### New heading~~}";
    const d = decorations(doc);
    expect(d.map((x) => [textOf(doc, x), x.cls])).toEqual([
      ["{~~", null],
      ["### Old heading", "cm-critic-del"],
      ["~>", null],
      ["### New heading", "cm-critic-ins"],
      ["~~}", null],
    ]);
  });

  it("renders a point comment as a single widget over the whole token", () => {
    const doc = "done{>>@llm: really?<<}";
    const d = decorations(doc);
    expect(d).toHaveLength(1);
    expect(d[0].widget).toBe(true);
    expect(textOf(doc, d[0])).toBe("{>>@llm: really?<<}");
  });

  it("highlights an anchored comment and marks it with a widget", () => {
    const doc = "the {==metrics==}{>>@llm: which?<<} agree";
    const d = decorations(doc);
    expect(d.map((x) => [textOf(doc, x), x.cls, x.widget])).toEqual([
      ["{==", null, false],
      ["metrics", "cm-critic-highlight", false],
      ["==}{>>@llm: which?<<}", null, true],
    ]);
  });

  it("gives a bare highlight no marker, since it has nothing to say", () => {
    const doc = "mind {==this==} here";
    const d = decorations(doc);
    expect(d.some((x) => x.widget)).toBe(false);
    expect(d.map((x) => [textOf(doc, x), x.cls])).toEqual([
      ["{==", null],
      ["this", "cm-critic-highlight"],
      ["==}", null],
    ]);
  });

  it("spans a decoration across lines without splitting it", () => {
    const doc = "x{--one\ntwo--}y";
    const d = decorations(doc);
    const del = d.find((x) => x.cls === "cm-critic-del")!;
    expect(textOf(doc, del)).toBe("one\ntwo");
  });

  it("produces nothing in source mode", () => {
    expect(decorations("a {--bad --}day", "source")).toEqual([]);
  });

  it("rebuilds when review mode is toggled on", () => {
    const source = stateFor("a {--bad --}day", "source");
    expect(source.field(criticDecorationField).size).toBe(0);
    const review = source.update({
      effects: [togglePreviewEffect.of(true), toggleReviewEffect.of(true)],
    }).state;
    expect(review.field(criticDecorationField).size).toBeGreaterThan(0);
  });
});

describe("selection follows the caret", () => {
  const doc = "{--a--} mid {++b++} end {~~c~>d~~}";
  const caretAt = (s: EditorState, at: number) => s.update({ selection: { anchor: at } }).state;

  it("selects the suggestion the caret sits inside", () => {
    // The whole point: putting the caret on an edit highlights that edit's card.
    const state = stateFor(doc);
    expect(currentSuggestion(caretAt(state, 3))!.type).toBe("deletion");
    expect(currentSuggestion(caretAt(state, 15))!.type).toBe("addition");
    expect(currentSuggestion(caretAt(state, 28))!.type).toBe("substitution");
  });

  it("selects the next suggestion when the caret is in ordinary prose", () => {
    // So deciding one leaves the following one ready to accept.
    const state = caretAt(stateFor(doc), 9); // inside " mid "
    expect(currentSuggestion(state)!.type).toBe("addition");
  });

  it("selects nothing once the caret is past the last suggestion", () => {
    // Needs trailing prose: a caret resting on the final token's closing edge is still
    // inside it, which is why `doc.length` on the bare document does not qualify.
    const trailing = doc + " and then some ordinary prose.";
    const state = caretAt(stateFor(trailing), trailing.length);
    expect(currentSuggestion(state)).toBeNull();
  });

  it("walks forward and back, clamping at both ends", () => {
    let state = stateFor(doc);
    const to = (s: EditorState, d: 1 | -1) =>
      s.update({ selection: { anchor: step(s, d)!.token.from } }).state;

    expect(currentSuggestion(state)!.type).toBe("deletion");
    state = to(state, 1);
    expect(currentSuggestion(state)!.type).toBe("addition");
    state = to(state, 1);
    expect(currentSuggestion(state)!.type).toBe("substitution");
    state = to(state, 1);
    expect(currentSuggestion(state)!.type).toBe("substitution"); // clamped at the end
    state = to(state, -1);
    expect(currentSuggestion(state)!.type).toBe("addition");
  });

  it("lands on the next suggestion after a decision, not on nothing", () => {
    // Ids are positional and every decision renumbers them, which is why nothing holds
    // an id between transactions.
    let state = stateFor(doc);
    const first = currentSuggestion(state)!;
    state = state.update({
      changes: { from: first.token.from, to: first.token.to, insert: "a" },
      selection: { anchor: first.token.from },
    }).state;
    expect(getSuggestions(state)).toHaveLength(2);
    expect(currentSuggestion(state)!.type).toBe("addition");
  });

  it("has no current suggestion once every one is decided", () => {
    const state = stateFor("{--a--}").update({ changes: { from: 0, to: 7, insert: "a" } }).state;
    expect(currentSuggestion(state)).toBeNull();
  });

  it("marks the selected point comment's widget so the star shows a ring", () => {
    // A point comment's token is replaced wholesale, so the ring has to live on the
    // widget — there is no text left for a mark decoration to paint.
    const doc2 = "done{>>@llm: really?<<} and more";
    const set = stateFor(doc2).update({ selection: { anchor: 4 } }).state
      .field(criticDecorationField);
    const iter = set.iter();
    let widget: { selected?: boolean } | null = null;
    while (iter.value) {
      const spec = iter.value.spec as { widget?: { selected?: boolean } };
      if (spec.widget) widget = spec.widget;
      iter.next();
    }
    expect(widget?.selected).toBe(true);
  });
});

/**
 * Preview is the document as it stands — the text you would have if you decided nothing.
 * Anything proposed is out of sight; anything already there survives.
 */
describe("preview projection", () => {
  const visible = (doc: string) => {
    const hidden = decorations(doc, "preview").filter((d) => d.cls === null && !d.widget);
    let out = "";
    let cursor = 0;
    for (const h of hidden.sort((a, b) => a.from - b.from)) {
      out += doc.slice(cursor, h.from);
      cursor = h.to;
    }
    return out + doc.slice(cursor);
  };

  it("keeps text a deletion proposes to remove", () => {
    expect(visible("a {--bad --}day")).toBe("a bad day");
  });

  it("hides text an addition proposes to add", () => {
    expect(visible("a day{++ indeed++}")).toBe("a day");
  });

  it("keeps the old half of a substitution and hides the new", () => {
    expect(visible("we {~~ship~>release~~} it")).toBe("we ship it");
  });

  it("keeps highlighted text and hides its comment", () => {
    expect(visible("the {==metrics==}{>>@llm: which?<<} agree")).toBe("the metrics agree");
  });

  it("hides a point comment entirely", () => {
    expect(visible("done{>>@llm: really?<<}")).toBe("done");
  });

  it("restores the colour of text the grammar greys as strikethrough", () => {
    // `{~~old~>new~~}` parses as one strikethrough node, so without this the surviving
    // half renders dimmed in Preview with nothing on screen to explain why.
    const doc = "we {~~ship~>release~~} it";
    const kept = decorations(doc, "preview").find((d) => d.cls === "cm-critic-kept");
    expect(kept).toBeDefined();
    expect(doc.slice(kept!.from, kept!.to)).toBe("ship");
  });

  it("matches what rejecting everything would write to disk", () => {
    // The invariant that makes Preview honest: what it shows is what the file becomes
    // if you walk away. Only whole-line collapsing differs, and only on its own lines.
    const doc = "we {~~ship~>release~~} it, {--maybe --}soon{>>@llm: hm<<}";
    expect(visible(doc)).toBe("we ship it, maybe soon");
  });
});
