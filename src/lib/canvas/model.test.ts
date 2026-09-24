import { describe, expect, it } from "vitest";
import {
  EMPTY_CANVAS, colorOf, kindOf, newSticky, parseCanvas, serializeCanvas, withColor, withoutNodes,
  type CanvasDoc,
} from "./model";

// Shaped like a file another app wrote: tab indentation, fields Onyx doesn't know
const FOREIGN = `{
\t"nodes":[
\t\t{"id":"a1","type":"text","text":"## Heading\\n![[note#Log]]","x":-180,"y":-160,"width":669,"height":1080,"styleAttributes":{"border":"dashed"}},
\t\t{"id":"b2","type":"file","file":"Folder/photo.jpg","x":520,"y":-118,"width":400,"height":300,"color":"4"},
\t\t{"id":"c3","type":"group","label":"Box","x":-600,"y":-700,"width":2000,"height":2000,"background":"bg.png","backgroundStyle":"cover"},
\t\t{"id":"d4","type":"link","url":"https://example.com","x":0,"y":0,"width":400,"height":80}
\t],
\t"edges":[
\t\t{"id":"e1","fromNode":"a1","fromSide":"right","toNode":"b2","toSide":"left","label":"days","toEnd":"none"},
\t\t{"id":"e2","fromNode":"a1","toNode":"missing"}
\t],
\t"metadata":{"version":"1.0-1.0"}
}`;

describe("parseCanvas / serializeCanvas", () => {
  it("keeps fields Onyx does not know, at every level", () => {
    const doc = parseCanvas(FOREIGN);
    const again = parseCanvas(serializeCanvas(doc)) as CanvasDoc & { metadata: unknown };
    expect(again.metadata).toEqual({ version: "1.0-1.0" });
    expect(again.nodes[0].styleAttributes).toEqual({ border: "dashed" });
    expect(again.nodes[2].background).toBe("bg.png");
    expect(again.edges[0].label).toBe("days");
  });

  it("drops edges whose ends are missing, keeps the rest", () => {
    const doc = parseCanvas(FOREIGN);
    expect(doc.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("round-trips to identical text once written by Onyx", () => {
    const once = serializeCanvas(parseCanvas(FOREIGN));
    expect(serializeCanvas(parseCanvas(once))).toBe(once);
  });

  it("writes tab-indented JSON with integer geometry", () => {
    const doc = parseCanvas(FOREIGN);
    doc.nodes[0].x = 10.6;
    const text = serializeCanvas(doc);
    expect(text.startsWith("{\n\t\"nodes\"")).toBe(true);
    expect(parseCanvas(text).nodes[0].x).toBe(11);
  });

  it("reads empty text and the empty template as an empty board", () => {
    expect(parseCanvas("")).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas(EMPTY_CANVAS)).toEqual({ nodes: [], edges: [] });
    expect(parseCanvas("{}")).toEqual({ nodes: [], edges: [] });
  });

  it("rejects malformed JSON rather than showing an empty board", () => {
    expect(() => parseCanvas("{ nodes: ")).toThrow();
    expect(() => parseCanvas("[]")).toThrow();
  });
});

describe("kindOf", () => {
  it("tells cards apart by type, file extension and onyx.kind", () => {
    const doc = parseCanvas(FOREIGN);
    expect(doc.nodes.map(kindOf)).toEqual(["markdown", "image", "frame", "link"]);
    expect(kindOf(newSticky(0, 0))).toBe("sticky");
    expect(kindOf({ id: "n", type: "file", file: "a/b.md", x: 0, y: 0, width: 1, height: 1 })).toBe("note");
    expect(kindOf({ id: "n", type: "file", file: "a/b.pdf", x: 0, y: 0, width: 1, height: 1 })).toBe("file");
  });
});

describe("colours", () => {
  it("reads JSON Canvas presets as palette names and hex as itself", () => {
    expect(colorOf({ color: "4" })).toBe("green");
    expect(colorOf({ color: "#ff0000" })).toBe("#ff0000");
    expect(colorOf({})).toBeNull();
    expect(colorOf({ color: "1", onyx: { color: "pink" } })).toBe("pink");
  });

  it("writes palette names to onyx.color and keeps a preset for other readers", () => {
    const green = withColor({ id: "x" } as { id: string; color?: string; onyx?: Record<string, unknown> }, "green");
    expect(green.onyx?.color).toBe("green");
    expect(green.color).toBe("4");
    const pink = withColor(green, "pink");
    expect(pink.color).toBeUndefined();
    expect(pink.onyx?.color).toBe("pink");
    const cleared = withColor(pink, null);
    expect(cleared.onyx).toBeUndefined();
    expect(cleared.color).toBeUndefined();
  });

  it("keeps other onyx fields when the colour changes", () => {
    const sticky = newSticky(0, 0, "blue");
    const red = withColor(sticky, "red");
    expect(red.onyx?.kind).toBe("sticky");
    expect(colorOf(red)).toBe("red");
  });
});

describe("withoutNodes", () => {
  it("removes nodes and the edges touching them", () => {
    const doc = parseCanvas(FOREIGN);
    const next = withoutNodes(doc, new Set(["b2"]));
    expect(next.nodes.map((n) => n.id)).toEqual(["a1", "c3", "d4"]);
    expect(next.edges).toEqual([]);
  });
});
