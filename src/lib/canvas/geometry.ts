import type { CanvasNode, Side } from "./model";

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
/** Board-to-screen mapping: screen = board × z + (x, y) */
export interface Viewport { x: number; y: number; z: number }

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;

export function toBoard(vp: Viewport, p: Point): Point {
  return { x: (p.x - vp.x) / vp.z, y: (p.y - vp.y) / vp.z };
}

/** Zoom by `factor` keeping the board point under `at` (screen coordinates) fixed. */
export function zoomAround(vp: Viewport, factor: number, at: Point): Viewport {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.z * factor));
  return { z, x: at.x - (at.x - vp.x) * (z / vp.z), y: at.y - (at.y - vp.y) * (z / vp.z) };
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A viewport showing all of `bounds` in a `width` × `height` screen, never above 100%. */
export function fitViewport(bounds: Rect | null, width: number, height: number, padding = 48): Viewport {
  if (!bounds || !width || !height) return { x: width / 2, y: height / 2, z: 1 };
  const z = Math.max(MIN_ZOOM, Math.min(1,
    (width - padding * 2) / Math.max(bounds.width, 1),
    (height - padding * 2) / Math.max(bounds.height, 1)));
  return {
    z,
    x: width / 2 - (bounds.x + bounds.width / 2) * z,
    y: height / 2 - (bounds.y + bounds.height / 2) * z,
  };
}

/** A viewport centring `rect` at zoom `z`. */
export function centreOn(rect: Rect, width: number, height: number, z: number): Viewport {
  return { z, x: width / 2 - (rect.x + rect.width / 2) * z, y: height / 2 - (rect.y + rect.height / 2) * z };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

export function normaliseRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

// ── Edges ──

export function anchor(n: Rect, side: Side): Point {
  switch (side) {
    case "top": return { x: n.x + n.width / 2, y: n.y };
    case "bottom": return { x: n.x + n.width / 2, y: n.y + n.height };
    case "left": return { x: n.x, y: n.y + n.height / 2 };
    case "right": return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

/** The side of `from` that faces `to`. */
export function facingSide(from: Rect, to: Point): Side {
  const dx = to.x - (from.x + from.width / 2);
  const dy = to.y - (from.y + from.height / 2);
  // Compare against the box's own proportions so wide cards pick top/bottom sensibly
  return Math.abs(dx) * from.height > Math.abs(dy) * from.width
    ? (dx > 0 ? "right" : "left")
    : (dy > 0 ? "bottom" : "top");
}

export function centreOf(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

const NORMAL: Record<Side, Point> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export interface EdgeGeometry { d: string; mid: Point; start: Point; end: Point; c1: Point; c2: Point }

/** Point at `t` (0–1) along an edge's curve. */
export function pointOnEdge(g: EdgeGeometry, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return {
    x: a * g.start.x + b * g.c1.x + c * g.c2.x + d * g.end.x,
    y: a * g.start.y + b * g.c1.y + c * g.c2.y + d * g.end.y,
  };
}

/**
 * A cubic curve leaving `start` along `fromSide`'s normal and arriving at `end` along
 * `toSide`'s (or straight at `end` when it has no side, as while dragging a new edge).
 */
export function edgeGeometry(start: Point, fromSide: Side, end: Point, toSide: Side | null): EdgeGeometry {
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const k = Math.min(Math.max(40, dist * 0.4), 300);
  const c1 = { x: start.x + NORMAL[fromSide].x * k, y: start.y + NORMAL[fromSide].y * k };
  const c2 = toSide ? { x: end.x + NORMAL[toSide].x * k, y: end.y + NORMAL[toSide].y * k } : end;
  const mid = {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  };
  return { d: `M${start.x},${start.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`, mid, start, end, c1, c2 };
}

/** Topmost node whose box holds `p`, frames last so a card on a frame wins. */
export function nodeAt(nodes: CanvasNode[], p: Point, skip?: Set<string>): CanvasNode | null {
  let frame: CanvasNode | null = null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (skip?.has(n.id)) continue;
    if (p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height) {
      if (n.type !== "group") return n;
      frame ??= n;
    }
  }
  return frame;
}

/** Nodes a frame carries when it moves: wholly inside it and above it in z-order. */
export function nodesInFrame(nodes: CanvasNode[], frame: CanvasNode): CanvasNode[] {
  const at = nodes.indexOf(frame);
  return nodes.filter((n, i) => n !== frame && i > at && contains(frame, n));
}
