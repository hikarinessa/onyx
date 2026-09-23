import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { tagAtPos } from "./wikilinks";

const doc = Text.of(["Plan #work/q3 and #idea, not a#hash or # space", "#start"]);

describe("tagAtPos", () => {
  it("finds the tag under the position, including nested segments", () => {
    expect(tagAtPos(doc, doc.toString().indexOf("#work") + 3)).toBe("work/q3");
    expect(tagAtPos(doc, doc.toString().indexOf("#idea"))).toBe("idea");
  });

  it("matches a tag at the start of a line", () => {
    expect(tagAtPos(doc, doc.line(2).from + 1)).toBe("start");
  });

  it("ignores a # inside a word and a bare #", () => {
    expect(tagAtPos(doc, doc.toString().indexOf("#hash"))).toBeNull();
    expect(tagAtPos(doc, doc.toString().indexOf("# space"))).toBeNull();
    expect(tagAtPos(doc, 1)).toBeNull();
  });
});
