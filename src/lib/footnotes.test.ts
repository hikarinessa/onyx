import { describe, expect, it } from "vitest";
import { parseFootnotes } from "./footnotes";

const slice = (doc: string, s: { from: number; to: number }) => doc.slice(s.from, s.to);

describe("parseFootnotes", () => {
  it("finds references and definitions with their offsets", () => {
    const doc = "A claim.[^1] More.\n\n[^1]: The source.";
    const { references, definitions } = parseFootnotes(doc);

    expect(references).toHaveLength(1);
    expect(slice(doc, references[0].token)).toBe("[^1]");
    expect(references[0].number).toBe(1);

    expect(definitions).toHaveLength(1);
    expect(slice(doc, definitions[0].marker)).toBe("[^1]:");
    expect(slice(doc, definitions[0].body)).toBe("The source.");
    expect(definitions[0].text).toBe("The source.");
  });

  it("numbers labels by first reference, not by label or definition order", () => {
    const doc = "One[^zeta] two[^alpha] again[^zeta]\n\n[^alpha]: A\n[^zeta]: Z";
    const { references, definitions } = parseFootnotes(doc);

    expect(references.map((r) => r.number)).toEqual([1, 2, 1]);
    expect(definitions.map((d) => [d.label, d.number])).toEqual([
      ["alpha", 2],
      ["zeta", 1],
    ]);
  });

  it("gives no number to a reference without a definition or a definition without references", () => {
    const doc = "Dangling[^nope] and real[^yes]\n\n[^yes]: Y\n[^orphan]: O";
    const { references, definitions } = parseFootnotes(doc);

    expect(references.map((r) => [r.label, r.number])).toEqual([
      ["nope", 0],
      ["yes", 1],
    ]);
    expect(definitions.find((d) => d.label === "orphan")?.number).toBe(0);
  });

  it("matches labels case-insensitively and keeps the first definition", () => {
    const doc = "Ref[^Note]\n\n[^note]: first\n[^NOTE]: second";
    const { references, definitions } = parseFootnotes(doc);

    expect(references[0].number).toBe(1);
    expect(definitions).toHaveLength(1);
    expect(definitions[0].text).toBe("first");
  });

  it("joins indented continuation lines, across blank lines, into one definition", () => {
    const doc = [
      "Text[^big]",
      "",
      "[^big]: Here's one with multiple paragraphs.",
      "\tIndent paragraphs to include them.",
      "",
      "    Add as many as you like.",
      "",
      "Back to prose.",
    ].join("\n");
    const { definitions } = parseFootnotes(doc);

    expect(definitions).toHaveLength(1);
    expect(definitions[0].text).toBe(
      "Here's one with multiple paragraphs.\nIndent paragraphs to include them.\n\nAdd as many as you like.",
    );
    expect(slice(doc, definitions[0].body).endsWith("Add as many as you like.")).toBe(true);
  });

  it("ends a definition at the first unindented line", () => {
    const doc = "Text[^a]\n\n[^a]: Note\nNot part of it[^a]";
    const { definitions, references } = parseFootnotes(doc);

    expect(definitions[0].text).toBe("Note");
    expect(references).toHaveLength(2);
  });

  it("ignores fenced code, inline code, frontmatter and escaped brackets", () => {
    const doc = [
      "---",
      "title: [^fm]",
      "---",
      "Real[^1] and `[^1]` and \\[^1]",
      "```",
      "[^1]: not a definition",
      "use [^1] here",
      "```",
      "",
      "[^1]: The real one",
    ].join("\n");
    const { references, definitions } = parseFootnotes(doc);

    expect(references).toHaveLength(1);
    expect(slice(doc, references[0].token)).toBe("[^1]");
    expect(definitions).toHaveLength(1);
    expect(definitions[0].text).toBe("The real one");
  });

  it("does not read the definition marker as a reference", () => {
    const doc = "Text[^1]\n\n[^1]: See also[^2]\n[^2]: Nested";
    const { references } = parseFootnotes(doc);

    expect(references.map((r) => r.label)).toEqual(["1", "2"]);
  });

  it("returns nothing for a document with no footnote syntax", () => {
    expect(parseFootnotes("Just [a link] and [[wiki]]")).toEqual({ references: [], definitions: [] });
  });
});
