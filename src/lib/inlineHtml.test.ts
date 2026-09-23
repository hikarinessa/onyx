import { describe, expect, it } from "vitest";
import { findHtmlSegments, safeColor, safeHref } from "./inlineHtml";

const pieces = (text: string) => findHtmlSegments(text).map((s) => text.slice(s.from, s.to));

describe("findHtmlSegments", () => {
  it("finds each balanced allowed element, outermost only", () => {
    const line = '| ★ | <font style="color:#A8C373">▲</font> ● <font style="color:#D04255">▼</font> |';
    expect(pieces(line)).toEqual(['<font style="color:#A8C373">▲</font>', '<font style="color:#D04255">▼</font>']);
    expect(pieces("<p>a <u>b</u><br>c</p> tail")).toEqual(["<p>a <u>b</u><br>c</p>"]);
  });

  it("takes a lone <br> on its own, in either form", () => {
    expect(pieces("one<br>two<br/>three")).toEqual(["<br>", "<br/>"]);
  });

  it("leaves unbalanced, unknown and non-HTML angle brackets as text", () => {
    expect(pieces("<font color=red>never closed")).toEqual([]);
    expect(pieces("<div>block</div> <iframe src=x></iframe> a < b > c")).toEqual([]);
    expect(pieces("</u> stray close")).toEqual([]);
  });

  it("matches case-insensitively and across mismatched inner tags", () => {
    expect(pieces("<SPAN style='color:red'>x <b>y</SPAN>")).toEqual(["<SPAN style='color:red'>x <b>y</SPAN>"]);
  });
});

describe("attribute filters", () => {
  it("keeps plain colours and nothing else from a style", () => {
    expect(safeColor("color:#A8C373")).toBe("#A8C373");
    expect(safeColor("font-weight:bold; color: rgb(10, 20, 30)")).toBe("rgb(10, 20, 30)");
    expect(safeColor("color: red")).toBe("red");
    expect(safeColor("color: url(javascript:alert(1))")).toBeNull();
    expect(safeColor("background:red")).toBeNull();
    expect(safeColor(null)).toBeNull();
  });

  it("opens only web and mail links", () => {
    expect(safeHref("https://x.com/a")).toBe("https://x.com/a");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("file:///etc/hosts")).toBeNull();
  });
});
