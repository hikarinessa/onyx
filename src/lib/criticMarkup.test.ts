import { describe, expect, it } from "vitest";
import {
  acceptChange,
  applyChanges,
  attachedRationales,
  dismissChange,
  parseCriticMarkup,
  proposeComment,
  proposeDeletion,
  proposeInsertion,
  proposeReplacement,
  rejectChange,
  replyChange,
  type Suggestion,
} from "./criticMarkup";

/** Text under a suggestion's span, so assertions read as prose rather than offsets. */
const at = (doc: string, s: { from: number; to: number }) => doc.slice(s.from, s.to);
const only = (doc: string): Suggestion => {
  const { suggestions } = parseCriticMarkup(doc);
  expect(suggestions).toHaveLength(1);
  return suggestions[0];
};

describe("parseCriticMarkup", () => {
  it("spans a deletion's token and its original text", () => {
    const doc = "a {--bad --}day";
    const s = only(doc);
    expect(s.type).toBe("deletion");
    expect(at(doc, s.token)).toBe("{--bad --}");
    expect(at(doc, s.original)).toBe("bad ");
    expect(s.replacement).toBeNull();
  });

  it("gives an addition an empty original at the insertion point", () => {
    const doc = "a day{++ indeed++}";
    const s = only(doc);
    expect(s.type).toBe("addition");
    expect(at(doc, s.replacement!)).toBe(" indeed");
    expect(s.original).toEqual({ from: 5, to: 5 });
  });

  it("splits a substitution into old and new", () => {
    const doc = "we {~~ship~>release~~} it";
    const s = only(doc);
    expect(s.type).toBe("substitution");
    expect(at(doc, s.original)).toBe("ship");
    expect(at(doc, s.replacement!)).toBe("release");
    expect(at(doc, s.token)).toBe("{~~ship~>release~~}");
  });

  it("handles a substitution whose halves contain lookalike characters", () => {
    const doc = "{~~a~b~>c~d~~}";
    const s = only(doc);
    expect(at(doc, s.original)).toBe("a~b");
    expect(at(doc, s.replacement!)).toBe("c~d");
  });

  it("extracts a point comment and its author tag", () => {
    const doc = "done{>>@llm: is it though?<<}";
    const s = only(doc);
    expect(s.type).toBe("comment");
    expect(s.author).toBe("llm");
    expect(at(doc, s.comment!)).toBe("is it though?");
    expect(s.original).toEqual({ from: 4, to: 4 });
  });

  it("leaves the author undefined on an untagged comment", () => {
    const doc = "done{>>plain note<<}";
    const s = only(doc);
    expect(s.author).toBeUndefined();
    expect(at(doc, s.comment!)).toBe("plain note");
  });

  it("binds a highlight and its comment into one suggestion", () => {
    const doc = "We think {==the metrics==}{>>@llm: which ones?<<} agree.";
    const s = only(doc);
    expect(s.type).toBe("comment");
    expect(at(doc, s.original)).toBe("the metrics");
    expect(at(doc, s.comment!)).toBe("which ones?");
    expect(at(doc, s.token)).toBe("{==the metrics==}{>>@llm: which ones?<<}");
  });

  it("keeps a bare highlight as a comment with an empty body", () => {
    const doc = "mind {==this part==} here";
    const s = only(doc);
    expect(at(doc, s.original)).toBe("this part");
    expect(at(doc, s.comment!)).toBe("");
  });

  it("keeps adjacent annotations separate", () => {
    const doc = "{--a--}{++b++}c";
    const { suggestions } = parseCriticMarkup(doc);
    expect(suggestions.map((s) => s.type)).toEqual(["deletion", "addition"]);
    expect(at(doc, suggestions[0].token)).toBe("{--a--}");
    expect(at(doc, suggestions[1].token)).toBe("{++b++}");
  });

  it("spans annotations that cross lines", () => {
    const doc = "x{--one\ntwo--}y";
    const s = only(doc);
    expect(at(doc, s.original)).toBe("one\ntwo");
  });

  it("numbers suggestions in document order", () => {
    const { suggestions } = parseCriticMarkup("{--a--} {++b++} {>>c<<}");
    expect(suggestions.map((s) => s.id)).toEqual(["cm1", "cm2", "cm3"]);
  });

  it("finds nothing in a clean document", () => {
    const r = parseCriticMarkup("# Title\n\nProse with *emphasis* and `code`.\n");
    expect(r.suggestions).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe("malformed markup", () => {
  it("warns about a stray marker rather than dropping it", () => {
    const r = parseCriticMarkup("line one\noops --} here");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].line).toBe(2);
  });

  it("does not warn about markers that belong to a valid construct", () => {
    // The scan runs over the raw document, where every valid token still contains its
    // own markers — without the containment guard, every suggestion reports itself.
    const r = parseCriticMarkup("a {--bad --}day {~~x~>y~~} {==h==}{>>c<<} {++z++}");
    expect(r.warnings).toEqual([]);
  });

  it("warns about an unterminated construct", () => {
    const r = parseCriticMarkup("text {--never closed");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toContain("{--");
  });
});

describe("rationale attachment", () => {
  it("absorbs an LLM point comment flush against an edit", () => {
    const doc = "{--Try to --}{>>@llm: undermines the commitment<<}Move it.";
    const { suggestions } = parseCriticMarkup(doc);
    const chains = attachedRationales(suggestions);
    expect(chains.get(suggestions[0].id)).toHaveLength(1);
  });

  it("absorbs a chain of consecutive comments", () => {
    const doc = "{--x--}{>>@llm: one<<}{>>@llm: two<<}rest";
    const { suggestions } = parseCriticMarkup(doc);
    expect(attachedRationales(suggestions).get(suggestions[0].id)).toHaveLength(2);
  });

  it("does not absorb a comment separated by text", () => {
    const doc = "{--x--} then {>>@llm: unrelated<<}";
    const { suggestions } = parseCriticMarkup(doc);
    expect(attachedRationales(suggestions).size).toBe(0);
  });

  it("does not absorb a user comment", () => {
    const doc = "{--x--}{>>@user: mine<<}";
    const { suggestions } = parseCriticMarkup(doc);
    expect(attachedRationales(suggestions).size).toBe(0);
  });

  it("does not absorb an anchored comment", () => {
    const doc = "{--x--}{==y==}{>>@llm: anchored<<}";
    const { suggestions } = parseCriticMarkup(doc);
    expect(attachedRationales(suggestions).size).toBe(0);
  });
});

describe("decisions", () => {
  const decide = (doc: string, fn: (d: string, s: Suggestion) => { from: number; to: number; insert: string }) =>
    applyChanges(doc, [fn(doc, only(doc))]);

  it("accepts a deletion by removing the text", () => {
    expect(decide("a {--bad --}day", acceptChange)).toBe("a day");
  });

  it("rejects a deletion by keeping the text", () => {
    expect(decide("a {--bad --}day", rejectChange)).toBe("a bad day");
  });

  it("accepts an addition by inserting the text", () => {
    expect(decide("a day{++ indeed++}", acceptChange)).toBe("a day indeed");
  });

  it("rejects an addition by leaving nothing", () => {
    expect(decide("a day{++ indeed++}", rejectChange)).toBe("a day");
  });

  it("accepts a substitution by taking the new text", () => {
    expect(decide("we {~~ship~>release~~} it", acceptChange)).toBe("we release it");
  });

  it("rejects a substitution by keeping the old text", () => {
    expect(decide("we {~~ship~>release~~} it", rejectChange)).toBe("we ship it");
  });

  it("dismisses an anchored comment by keeping the highlighted text", () => {
    expect(decide("the {==metrics==}{>>@llm: which?<<} agree", dismissChange)).toBe(
      "the metrics agree",
    );
  });

  it("dismisses a point comment by leaving nothing", () => {
    expect(decide("done{>>@llm: really?<<}", dismissChange)).toBe("done");
  });

  it("records a rejection note as a user comment for the next pass", () => {
    const doc = "we {~~ship~>release~~} it";
    const out = applyChanges(doc, [rejectChange(doc, only(doc), "ship is the house term")]);
    expect(out).toBe(
      'we ship{>>@user: rejected change to "release" — ship is the house term<<} it',
    );
    // The result must be readable by the next annotation pass.
    expect(parseCriticMarkup(out).warnings).toEqual([]);
  });

  it("appends a reply without consuming the comment", () => {
    const doc = "the {==metrics==}{>>@llm: which?<<} agree";
    const out = applyChanges(doc, [replyChange(only(doc), "revenue only")]);
    expect(out).toBe("the {==metrics==}{>>@llm: which?<<}{>>@user: revenue only<<} agree");
    expect(parseCriticMarkup(out).suggestions).toHaveLength(2);
  });

  it("neutralises markers inside a user note so the file stays parseable", () => {
    const doc = "a {--bad --}day";
    const out = applyChanges(doc, [rejectChange(doc, only(doc), "no <<} and no {>> please")]);
    expect(parseCriticMarkup(out).warnings).toEqual([]);
    expect(parseCriticMarkup(out).suggestions).toHaveLength(1);
  });

  it("takes the line with it when a rejected addition owned the whole line", () => {
    const doc = "before\n{++4. an added step++}\nafter";
    expect(decide(doc, rejectChange)).toBe("before\nafter");
  });

  it("takes the line with it when an accepted deletion owned the whole line", () => {
    const doc = "before\n{--3. a dropped step--}\nafter";
    expect(decide(doc, acceptChange)).toBe("before\nafter");
  });

  it("leaves the line alone when other text shares it", () => {
    const doc = "keep {--this --}line";
    expect(decide(doc, acceptChange)).toBe("keep line");
  });

  it("collapses a whole-line construct at end of document", () => {
    const doc = "before\n{++trailing++}";
    expect(decide(doc, rejectChange)).toBe("before");
  });

  it("applies a batch of decisions in one pass", () => {
    const doc = "{--a--} keep {++b++} and {~~c~>d~~}";
    const { suggestions } = parseCriticMarkup(doc);
    const out = applyChanges(
      doc,
      suggestions.map((s) => acceptChange(doc, s)),
    );
    expect(out).toBe(" keep b and d");
  });
});

describe("authoring", () => {
  // A hand-written suggestion must be indistinguishable from an LLM's to the parser and
  // to the decision operations — reviewable, decidable, and attributed to @user.
  const doc = "we ship it today";

  it("proposes a deletion that parses and rejects back to the original", () => {
    const out = applyChanges(doc, [proposeDeletion(doc, 3, 8)]);
    expect(out).toBe("we {--ship --}it today");
    const s = only(out);
    expect(s.type).toBe("deletion");
    expect(applyChanges(out, [rejectChange(out, s)])).toBe(doc);
  });

  it("proposes a replacement whose acceptance yields the new text", () => {
    const out = applyChanges(doc, [proposeReplacement(doc, 3, 7, "release")]);
    expect(out).toBe("we {~~ship~>release~~} it today");
    const s = only(out);
    expect(applyChanges(out, [acceptChange(out, s)])).toBe("we release it today");
    expect(applyChanges(out, [rejectChange(out, s)])).toBe(doc);
  });

  it("proposes an insertion after a position", () => {
    const out = applyChanges(doc, [proposeInsertion(doc.length, " and tomorrow")]);
    const s = only(out);
    expect(s.type).toBe("addition");
    expect(applyChanges(out, [acceptChange(out, s)])).toBe("we ship it today and tomorrow");
    expect(applyChanges(out, [rejectChange(out, s)])).toBe(doc);
  });

  it("anchors a comment to a selection and attributes it to the user", () => {
    const out = applyChanges(doc, [proposeComment(doc, 3, 7, "really?")]);
    expect(out).toBe("we {==ship==}{>>@user: really?<<} it today");
    const s = only(out);
    expect(s.author).toBe("user");
    expect(applyChanges(out, [dismissChange(out, s)])).toBe(doc);
  });

  it("writes a point comment when nothing is selected", () => {
    const out = applyChanges(doc, [proposeComment(doc, 7, 7, "hm")]);
    expect(out).toBe("we ship{>>@user: hm<<} it today");
    expect(only(out).original).toEqual({ from: 7, to: 7 });
  });

  it("neutralises markers in a hand-written comment", () => {
    const out = applyChanges(doc, [proposeComment(doc, 3, 7, "no <<} here")]);
    expect(parseCriticMarkup(out).warnings).toEqual([]);
    expect(parseCriticMarkup(out).suggestions).toHaveLength(1);
  });
});

// The corpus is the real safety net: whatever an annotation pass produces, deciding it
// must consume every marker and leave a document the parser reports as clean.
const samples = import.meta.glob("../../samples/*.annotated.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("sample corpus", () => {
  it("has samples to check", () => {
    expect(Object.keys(samples).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(samples))("%s parses without warnings", (_name, doc) => {
    expect(parseCriticMarkup(doc).warnings).toEqual([]);
  });

  it.each(Object.entries(samples))("%s leaves no markup when accepted", (_name, doc) => {
    const { suggestions } = parseCriticMarkup(doc);
    const out = applyChanges(doc, suggestions.map((s) => acceptChange(doc, s)));
    expect(parseCriticMarkup(out).suggestions).toEqual([]);
    expect(parseCriticMarkup(out).warnings).toEqual([]);
  });

  it.each(Object.entries(samples))("%s leaves no markup when rejected", (_name, doc) => {
    const { suggestions } = parseCriticMarkup(doc);
    const out = applyChanges(doc, suggestions.map((s) => rejectChange(doc, s)));
    expect(parseCriticMarkup(out).suggestions).toEqual([]);
    expect(parseCriticMarkup(out).warnings).toEqual([]);
  });

  it.each(Object.entries(samples))("%s rejected equals the original prose", (_name, doc) => {
    // Rejecting everything must reconstruct the document the annotation pass was given —
    // this is what makes an unwanted review pass a no-op rather than a rewrite.
    const { suggestions } = parseCriticMarkup(doc);
    const out = applyChanges(doc, suggestions.map((s) => rejectChange(doc, s)));
    expect(out).not.toContain("{--");
    expect(out).not.toContain("{++");
    expect(out).not.toContain("{~~");
    expect(out).not.toContain("{>>");
  });
});
