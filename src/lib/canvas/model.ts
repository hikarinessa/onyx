/**
 * Canvas documents: JSON Canvas 1.0 (jsoncanvas.org) plus an `onyx` object on the
 * document, nodes and edges for what the spec has no field for. Fields Onyx doesn't know
 * are carried through untouched, so a file another app wrote loses nothing on save.
 */

export type Side = "top" | "right" | "bottom" | "left";
export type EndShape = "none" | "arrow";
export type NodeType = "text" | "file" | "link" | "group";

export interface OnyxNodeFields {
  /** Absent means a markdown card */
  kind?: "sticky" | "label";
  /** Palette name (see PALETTE) or a custom `#rrggbb` */
  color?: string;
  /** Label text size in board pixels */
  fontSize?: number;
  [key: string]: unknown;
}

export interface CanvasNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  onyx?: OnyxNodeFields;
  [key: string]: unknown;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  fromEnd?: EndShape;
  toEnd?: EndShape;
  color?: string;
  label?: string;
  onyx?: { dash?: boolean; color?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  onyx?: { version?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export const EMPTY_CANVAS = '{\n\t"nodes": [],\n\t"edges": []\n}\n';

// ── Read and write ──

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Parse a canvas file. Empty text is an empty board; malformed JSON throws. */
export function parseCanvas(text: string): CanvasDoc {
  if (!text.trim()) return { nodes: [], edges: [] };
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("A canvas file must hold a JSON object");
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object" && typeof n.id === "string")
    .map((n) => ({
      ...n,
      id: n.id as string,
      type: (["text", "file", "link", "group"].includes(n.type as string) ? n.type : "text") as NodeType,
      x: num(n.x, 0),
      y: num(n.y, 0),
      width: num(n.width, 250),
      height: num(n.height, 60),
    }) as CanvasNode);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .filter((e): e is Record<string, unknown> =>
      !!e && typeof e === "object" && typeof e.id === "string" &&
      ids.has(e.fromNode as string) && ids.has(e.toNode as string))
    .map((e) => ({ ...e }) as CanvasEdge);
  return { ...raw, nodes, edges } as CanvasDoc;
}

/**
 * Serialise with tab indentation, as Obsidian writes, so a file edited in either app
 * diffs cleanly. Positions and sizes are integers, as the spec requires.
 */
export function serializeCanvas(doc: CanvasDoc): string {
  const out: CanvasDoc = {
    ...doc,
    nodes: doc.nodes.map((n) => ({
      ...n,
      x: Math.round(n.x),
      y: Math.round(n.y),
      width: Math.round(n.width),
      height: Math.round(n.height),
    })),
  };
  return JSON.stringify(out, null, "\t") + "\n";
}

// ── What a node is ──

export type CardKind = "sticky" | "label" | "markdown" | "note" | "image" | "file" | "link" | "frame";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic)$/i;

export function kindOf(node: CanvasNode): CardKind {
  switch (node.type) {
    case "group": return "frame";
    case "link": return "link";
    case "file":
      if (IMAGE_RE.test(node.file ?? "")) return "image";
      return /\.md$/i.test(node.file ?? "") ? "note" : "file";
    default:
      return node.onyx?.kind === "sticky" ? "sticky" : node.onyx?.kind === "label" ? "label" : "markdown";
  }
}

// ── Colours ──

/** Sticky and card colours, resolved per theme through `--canvas-<name>` tokens. */
export const PALETTE = ["yellow", "orange", "red", "pink", "purple", "blue", "cyan", "green", "gray"] as const;
export type PaletteName = (typeof PALETTE)[number];

const PRESET_TO_NAME: Record<string, PaletteName> = {
  "1": "red", "2": "orange", "3": "yellow", "4": "green", "5": "cyan", "6": "purple",
};
const NAME_TO_PRESET: Partial<Record<PaletteName, string>> = Object.fromEntries(
  Object.entries(PRESET_TO_NAME).map(([k, v]) => [v, k]),
);

/** A node's or edge's colour: a palette name, a custom hex, or none. */
export function colorOf(item: { color?: string; onyx?: { color?: string } }): string | null {
  const own = item.onyx?.color;
  if (own) return own;
  if (!item.color) return null;
  return PRESET_TO_NAME[item.color] ?? item.color;
}

/** CSS colour for a palette name or hex. */
export function cssColor(color: string): string {
  return (PALETTE as readonly string[]).includes(color) ? `var(--canvas-${color})` : color;
}

/**
 * Set a colour. The palette name goes in `onyx.color`; `color` keeps the nearest JSON
 * Canvas value (a preset number or the hex), so other readers still see a colour.
 */
export function withColor<T extends { color?: string; onyx?: Record<string, unknown> }>(item: T, color: string | null): T {
  const onyx = { ...(item.onyx ?? {}) };
  const next = { ...item };
  if (!color) {
    delete onyx.color;
    delete next.color;
  } else if ((PALETTE as readonly string[]).includes(color)) {
    onyx.color = color;
    const preset = NAME_TO_PRESET[color as PaletteName];
    if (preset) next.color = preset;
    else delete next.color;
  } else {
    delete onyx.color;
    next.color = color;
  }
  if (Object.keys(onyx).length) next.onyx = onyx;
  else delete next.onyx;
  return next;
}

// ── New items ──

export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const STICKY_SIZE = 200;

export function newSticky(x: number, y: number, color: PaletteName = "yellow"): CanvasNode {
  return withColor({ id: newId(), type: "text", text: "", x, y, width: STICKY_SIZE, height: STICKY_SIZE, onyx: { kind: "sticky" } }, color);
}

export function newMarkdownCard(x: number, y: number): CanvasNode {
  return { id: newId(), type: "text", text: "", x, y, width: 360, height: 240 };
}

export function newLabel(x: number, y: number): CanvasNode {
  return { id: newId(), type: "text", text: "", x, y, width: 320, height: 60, onyx: { kind: "label", fontSize: 32 } };
}

export function newFrame(x: number, y: number, width = 800, height = 600): CanvasNode {
  return { id: newId(), type: "group", label: "Frame", x, y, width, height };
}

export function newFileCard(file: string, x: number, y: number, subpath?: string): CanvasNode {
  const image = IMAGE_RE.test(file);
  const node: CanvasNode = { id: newId(), type: "file", file, x, y, width: 400, height: image ? 300 : 400 };
  if (subpath) node.subpath = subpath.startsWith("#") ? subpath : `#${subpath}`;
  return node;
}

export function newLinkCard(url: string, x: number, y: number): CanvasNode {
  return { id: newId(), type: "link", url, x, y, width: 400, height: 80 };
}

export function newEdge(fromNode: string, fromSide: Side, toNode: string, toSide: Side): CanvasEdge {
  return { id: newId(), fromNode, fromSide, toNode, toSide };
}

/**
 * Remove nodes and every edge touching them. Frames sit below their contents in the
 * array (z-order), so removal keeps the order of what remains.
 */
export function withoutNodes(doc: CanvasDoc, ids: Set<string>): CanvasDoc {
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !ids.has(n.id)),
    edges: doc.edges.filter((e) => !ids.has(e.id) && !ids.has(e.fromNode) && !ids.has(e.toNode)),
  };
}
