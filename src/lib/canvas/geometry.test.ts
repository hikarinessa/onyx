import { describe, expect, it } from "vitest";
import {
  anchor, edgeGeometry, facingSide, fitViewport, nodeAt, nodesInFrame, pointOnEdge, toBoard, zoomAround,
  MAX_ZOOM,
} from "./geometry";
import type { CanvasNode } from "./model";

const node = (id: string, x: number, y: number, width: number, height: number, type: CanvasNode["type"] = "text"): CanvasNode =>
  ({ id, type, x, y, width, height });

describe("viewport", () => {
  it("keeps the point under the pointer fixed while zooming", () => {
    const vp = { x: 40, y: -20, z: 0.5 };
    const at = { x: 300, y: 200 };
    const before = toBoard(vp, at);
    const after = toBoard(zoomAround(vp, 1.7, at), at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps zoom", () => {
    expect(zoomAround({ x: 0, y: 0, z: 3 }, 10, { x: 0, y: 0 }).z).toBe(MAX_ZOOM);
  });

  it("fits a board inside the screen without zooming past 100%", () => {
    const vp = fitViewport({ x: 0, y: 0, width: 4000, height: 1000 }, 1000, 800);
    expect(vp.z).toBeLessThan(0.25);
    expect(fitViewport({ x: 0, y: 0, width: 10, height: 10 }, 1000, 800).z).toBe(1);
    // Centred: the board's middle maps to the screen's middle
    expect(2000 * vp.z + vp.x).toBeCloseTo(500);
  });
});

describe("edges", () => {
  const a = node("a", 0, 0, 200, 100);

  it("anchors at the middle of each side", () => {
    expect(anchor(a, "right")).toEqual({ x: 200, y: 50 });
    expect(anchor(a, "top")).toEqual({ x: 100, y: 0 });
  });

  it("picks the side facing the other end, relative to the card's shape", () => {
    expect(facingSide(a, { x: 500, y: 60 })).toBe("right");
    expect(facingSide(a, { x: 100, y: -300 })).toBe("top");
    expect(facingSide(a, { x: 260, y: 170 })).toBe("bottom");
  });

  it("starts and ends the curve on its anchors", () => {
    const g = edgeGeometry({ x: 0, y: 0 }, "right", { x: 300, y: 100 }, "left");
    expect(pointOnEdge(g, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnEdge(g, 1)).toEqual({ x: 300, y: 100 });
    expect(g.mid).toEqual(pointOnEdge(g, 0.5));
  });
});

describe("hit testing and frames", () => {
  const frame = node("f", 0, 0, 1000, 1000, "group");
  const inside = node("in", 100, 100, 200, 200);
  const straddling = node("half", 900, 100, 200, 200);
  const below = node("under", 200, 200, 100, 100);
  const nodes = [below, frame, inside, straddling];

  it("prefers a card over the frame it sits on", () => {
    expect(nodeAt(nodes, { x: 150, y: 150 })?.id).toBe("in");
    expect(nodeAt(nodes, { x: 600, y: 600 })?.id).toBe("f");
    expect(nodeAt(nodes, { x: 5000, y: 5000 })).toBeNull();
  });

  it("carries only what is wholly inside and above the frame", () => {
    expect(nodesInFrame(nodes, frame).map((n) => n.id)).toEqual(["in"]);
  });
});
