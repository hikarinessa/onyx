import { describe, expect, it } from "vitest";
import { extractSection, splitSubpath } from "./sections";

const NOTE = `---
type: monthly
---
# Month

Intro line.

## Log

- first
- second

### Detail

Deep.

## Review

\`\`\`md
## Not a heading
\`\`\`

Closing thoughts. ^closing

- item one ^item1
- item two
`;

describe("splitSubpath", () => {
  it("separates the note from its subpath", () => {
    expect(splitSubpath("2025-01#Log")).toEqual({ target: "2025-01", subpath: "Log" });
    expect(splitSubpath("folder/note#^abc")).toEqual({ target: "folder/note", subpath: "^abc" });
    expect(splitSubpath("plain")).toEqual({ target: "plain", subpath: null });
    expect(splitSubpath("trailing#")).toEqual({ target: "trailing", subpath: null });
  });
});

describe("extractSection", () => {
  it("returns a heading and its subsections up to the next heading of equal level", () => {
    expect(extractSection(NOTE, "Log")).toBe("## Log\n\n- first\n- second\n\n### Detail\n\nDeep.");
  });

  it("matches headings case- and space-insensitively, with or without a leading #", () => {
    expect(extractSection(NOTE, "#  detail ")).toBe("### Detail\n\nDeep.");
  });

  it("runs to the end of the note for the last section", () => {
    expect(extractSection(NOTE, "Review")?.endsWith("- item two")).toBe(true);
  });

  it("ignores headings inside fenced code", () => {
    expect(extractSection(NOTE, "Not a heading")).toBeNull();
    expect(extractSection(NOTE, "Review")).toContain("## Not a heading");
  });

  it("follows nested segments", () => {
    expect(extractSection(NOTE, "Month#Log#Detail")).toBe("### Detail\n\nDeep.");
    expect(extractSection(NOTE, "Review#Detail")).toBeNull();
  });

  it("returns a block by its id, without the marker", () => {
    expect(extractSection(NOTE, "^closing")).toBe("Closing thoughts.");
    expect(extractSection(NOTE, "^item1")).toBe("- item one");
    expect(extractSection(NOTE, "^missing")).toBeNull();
  });

  it("returns null for a heading that does not exist", () => {
    expect(extractSection(NOTE, "Nowhere")).toBeNull();
  });
});
