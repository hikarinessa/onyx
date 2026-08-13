import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  criticDecorationField,
  criticMarkupExtension,
  getClaimedRanges,
  getSuggestions,
} from "./criticMarkup";
import { previewModeField, togglePreviewEffect } from "./livePreview";

/**
 * Decorations are built by a StateField, so they can be checked without a DOM — a widget
 * only touches `document` when it renders. This is the difference between "the extension
 * typechecks" and "the extension puts decorations at the right offsets".
 */
function stateFor(doc: string, preview = true): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [previewModeField, criticMarkupExtension()],
  });
  return preview ? state.update({ effects: togglePreviewEffect.of(true) }).state : state;
}

interface Deco {
  from: number;
  to: number;
  cls: string | null;
  widget: boolean;
}

function decorations(doc: string, preview = true): Deco[] {
  const set = stateFor(doc, preview).field(criticDecorationField);
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

  it("leaves a block-crossing substitution raw", () => {
    const doc = "{~~### Old heading~>### New heading~~}";
    const d = decorations(doc);
    // Markers stay visible — only the two halves are coloured.
    expect(d.map((x) => x.cls)).toEqual(["cm-critic-del", "cm-critic-ins"]);
    expect(textOf(doc, d[0])).toBe("### Old heading");
    expect(textOf(doc, d[1])).toBe("### New heading");
  });

  it("treats a list-item substitution as block-crossing too", () => {
    const d = decorations("{~~- old item~>- new item~~}");
    expect(d.map((x) => x.cls)).toEqual(["cm-critic-del", "cm-critic-ins"]);
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
    expect(decorations("a {--bad --}day", false)).toEqual([]);
  });

  it("rebuilds when preview mode is toggled on", () => {
    const source = stateFor("a {--bad --}day", false);
    expect(source.field(criticDecorationField).size).toBe(0);
    const preview = source.update({ effects: togglePreviewEffect.of(true) }).state;
    expect(preview.field(criticDecorationField).size).toBeGreaterThan(0);
  });
});
