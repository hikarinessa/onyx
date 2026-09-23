import { describe, expect, it } from "vitest";
import { MD_IMAGE_RE, WIKI_IMAGE_RE, isImageName, parseSize, splitAlt } from "./imageRefs";

const wiki = (text: string) => [...text.matchAll(WIKI_IMAGE_RE)].map((m) => [m[1], m[2]]);
const md = (text: string) => [...text.matchAll(MD_IMAGE_RE)].map((m) => [m[1], m[2]]);

describe("image references", () => {
  it("finds embeds anywhere on a line, with or without an option", () => {
    expect(wiki("- it went great!![[BurnNightIndexCards.png]]")).toEqual([["BurnNightIndexCards.png", undefined]]);
    expect(wiki("![[Woodland Zip Tie.png]] ![[Woodland Zip Tie 2.PNG|300]]")).toEqual([
      ["Woodland Zip Tie.png", undefined],
      ["Woodland Zip Tie 2.PNG", "300"],
    ]);
  });

  it("leaves note embeds and plain links alone", () => {
    expect(wiki("![[Some Note]] and ![[Other.md]] and [[photo.png]]")).toEqual([]);
    expect(md("[text](https://example.com/a.png)")).toEqual([]);
  });

  it("reads markdown images with web, relative and angle-bracketed urls", () => {
    expect(md("![](https://x.org/64.png)")).toEqual([["", "https://x.org/64.png"]]);
    expect(md('![A chart|300](pics/a%20b.png "title")')).toEqual([["A chart|300", "pics/a%20b.png"]]);
    expect(md("![x](<pics/c.jpg>)")).toEqual([["x", "pics/c.jpg"]]);
  });

  it("reads Obsidian sizes and keeps other options as alt text", () => {
    expect(parseSize("300")).toEqual({ width: 300, height: undefined });
    expect(parseSize("300x200")).toEqual({ width: 300, height: 200 });
    expect(parseSize("a caption")).toBeNull();
    expect(splitAlt("A chart|300")).toEqual({ alt: "A chart", size: { width: 300, height: undefined } });
    expect(splitAlt("a|b")).toEqual({ alt: "a|b", size: null });
  });

  it("recognises image file names by extension, in any case", () => {
    expect(isImageName("photo.JPEG")).toBe(true);
    expect(isImageName("Note.md")).toBe(false);
  });
});
