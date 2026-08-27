import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  brokenLinksField,
  collectLinkTargets,
  linkTargetAt,
  setBrokenLinks,
} from "./brokenLinks";

/**
 * The resolver itself talks to Rust and cannot run here. What can be pinned down is the
 * half that decides *which* links get sent and *which* get marked: the target extraction
 * must agree with what the click handler reads, or a link could dim as broken and still
 * open, or open nothing and still look fine.
 */
const stateOf = (doc: string) => EditorState.create({ doc, extensions: [brokenLinksField] });

describe("collectLinkTargets", () => {
  it("collects each distinct target once", () => {
    expect(collectLinkTargets(stateOf("[[A]] and [[B]] and [[A]] again"))).toEqual(["A", "B"]);
  });

  it("strips an alias and a heading anchor down to the note name", () => {
    // The resolver looks up notes, not headings or display text.
    expect(collectLinkTargets(stateOf("[[Note|shown as this]] [[Other#Section]]"))).toEqual([
      "Note",
      "Other",
    ]);
  });

  it("ignores embeds, which are handled elsewhere", () => {
    expect(collectLinkTargets(stateOf("![[image.png]] and [[Real]]"))).toEqual(["Real"]);
  });

  it("keeps a path-style target intact so step 1 of resolution can use it", () => {
    expect(collectLinkTargets(stateOf("[[Meta/Templates/Daily]]"))).toEqual(["Meta/Templates/Daily"]);
  });

  it("finds nothing in a document with no links", () => {
    expect(collectLinkTargets(stateOf("plain prose, no brackets"))).toEqual([]);
  });
});

describe("linkTargetAt", () => {
  const doc = "see [[Note|alias]] here";

  it("returns the target for a position inside the link", () => {
    expect(linkTargetAt(stateOf(doc), 7)).toBe("Note");
  });

  it("returns the target at both edges of the construct", () => {
    expect(linkTargetAt(stateOf(doc), 4)).toBe("Note");
    expect(linkTargetAt(stateOf(doc), 18)).toBe("Note");
  });

  it("returns null in plain text", () => {
    expect(linkTargetAt(stateOf(doc), 1)).toBeNull();
    expect(linkTargetAt(stateOf(doc), 21)).toBeNull();
  });
});

describe("brokenLinksField", () => {
  it("starts empty and takes whatever the resolver reports", () => {
    let state = stateOf("[[A]] [[B]]");
    expect(state.field(brokenLinksField).size).toBe(0);
    state = state.update({ effects: setBrokenLinks.of(new Set(["B"])) }).state;
    expect([...state.field(brokenLinksField)]).toEqual(["B"]);
  });

  it("replaces rather than merges, so a link that gains a target stops being broken", () => {
    let state = stateOf("[[A]] [[B]]");
    state = state.update({ effects: setBrokenLinks.of(new Set(["A", "B"])) }).state;
    state = state.update({ effects: setBrokenLinks.of(new Set(["B"])) }).state;
    expect([...state.field(brokenLinksField)]).toEqual(["B"]);
  });
});
