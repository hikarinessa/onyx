import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { footnoteDecorationField, footnotesExtension, referenceAt } from "./footnotes";
import { previewModeField, togglePreviewEffect } from "./livePreview";

/**
 * Every test document starts with a line of its own for the cursor, because the line
 * holding the cursor shows raw syntax. `cursor` moves it elsewhere.
 */
const TOP = "Top line\n";

function stateFor(body: string, preview = true, cursor = 0): EditorState {
  const state = EditorState.create({
    doc: TOP + body,
    selection: { anchor: cursor },
    extensions: [previewModeField, footnotesExtension()],
  });
  return preview ? state.update({ effects: togglePreviewEffect.of(true) }).state : state;
}

/** Decorated ranges: number widgets with the number they show, and definition-body marks. */
function widgets(state: EditorState): { text: string; number: number; role: string }[] {
  const out: { text: string; number: number; role: string }[] = [];
  const iter = state.field(footnoteDecorationField).iter();
  while (iter.value) {
    const w = iter.value.spec.widget as { number: number; role: string } | undefined;
    out.push({
      text: state.doc.sliceString(iter.from, iter.to),
      number: w?.number ?? 0,
      role: w?.role ?? "body",
    });
    iter.next();
  }
  return out;
}

describe("footnoteDecorationField", () => {
  const doc = "Claim[^src] and[^missing].\n\n[^src]: Where it came from.\n[^unused]: Nobody cites this.";

  it("replaces numbered references and definition markers in preview", () => {
    expect(widgets(stateFor(doc))).toEqual([
      { text: "[^src]", number: 1, role: "ref" },
      { text: "[^src]:", number: 1, role: "def" },
      { text: "Where it came from.", number: 0, role: "body" },
    ]);
  });

  it("leaves dangling references and unreferenced definitions as text", () => {
    const texts = widgets(stateFor(doc)).map((w) => w.text);
    expect(texts).not.toContain("[^missing]");
    expect(texts).not.toContain("[^unused]:");
  });

  it("renders nothing in source mode, and follows a toggle into preview", () => {
    const source = stateFor(doc, false);
    expect(widgets(source)).toEqual([]);
    const preview = source.update({ effects: togglePreviewEffect.of(true) }).state;
    expect(widgets(preview)).toHaveLength(3);
  });

  it("renumbers when an edit changes which label is referenced first", () => {
    const two = "A[^b] B[^a]\n\n[^a]: a\n[^b]: b";
    const state = stateFor(two);
    expect(widgets(state).filter((w) => w.role === "ref").map((w) => w.number)).toEqual([1, 2]);

    // Delete the first reference: [^a] becomes footnote 1.
    const at = TOP.length + 1;
    const edited = state.update({ changes: { from: at, to: at + 4 } }).state;
    expect(widgets(edited).filter((w) => w.role === "ref")).toEqual([
      { text: "[^a]", number: 1, role: "ref" },
    ]);
  });
});

describe("footnoteDecorationField on the cursor line", () => {
  const body = "Claim[^n] here.\n\n[^n]: The note.";
  const refLine = TOP.length + 2;
  const defLine = TOP.length + body.indexOf("[^n]:") + 7;

  it("shows the raw reference while the cursor is on its line", () => {
    expect(widgets(stateFor(body, true, refLine)).map((w) => w.text)).toEqual(["[^n]:", "The note."]);
  });

  it("shows the raw definition marker while the cursor is on its line", () => {
    expect(widgets(stateFor(body, true, defLine)).map((w) => w.text)).toEqual(["[^n]"]);
  });

  it("renders the line again once the cursor leaves it", () => {
    const onRef = stateFor(body, true, refLine);
    const away = onRef.update({ selection: { anchor: 0 } }).state;
    expect(widgets(away).map((w) => w.text)).toEqual(["[^n]", "[^n]:", "The note."]);
  });
});

describe("referenceAt", () => {
  const doc = TOP + "Text[^1] more\n\n[^1]: note";
  const state = stateFor(doc.slice(TOP.length));
  const from = doc.indexOf("[^1]");
  const to = from + 4;

  it("finds the reference from inside the token", () => {
    expect(referenceAt(state, from + 2)?.label).toBe("1");
  });

  it("respects which side of a widget boundary the pointer is on", () => {
    expect(referenceAt(state, from, 1)?.label).toBe("1");
    expect(referenceAt(state, from, -1)).toBeUndefined();
    expect(referenceAt(state, to, -1)?.label).toBe("1");
    expect(referenceAt(state, to, 1)).toBeUndefined();
  });

  it("does not treat the definition marker as a reference", () => {
    expect(referenceAt(state, doc.lastIndexOf("[^1]") + 1)).toBeUndefined();
  });
});
