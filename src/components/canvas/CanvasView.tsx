/**
 * A canvas tab: an infinite board of stickies, cards, images, frames and edges.
 *
 * Items are DOM elements in one "world" layer moved by a single CSS transform, so panning
 * and zooming never re-render cards; React re-renders only to cull items that leave the
 * screen and to swap detail levels. Every change to the board goes through the canvas
 * store's `commit`, which is undoable and saves on the auto-save timer.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  FileText, Frame, Image as ImageIcon, Maximize, Minus, MousePointer2, Plus,
  RectangleHorizontal, Redo2, StickyNote, Trash2, Type, Undo2,
} from "lucide-react";
import {
  PALETTE, colorOf, cssColor, kindOf, newEdge, newFileCard, newFrame, newId, newLabel, newLinkCard,
  newMarkdownCard, newSticky, withColor, withoutNodes,
  type CanvasDoc, type CanvasEdge, type CanvasNode, type PaletteName, type Side,
} from "../../lib/canvas/model";
import {
  boundsOf, centreOn, contains, fitViewport, intersects, nodeAt, nodesInFrame, normaliseRect, toBoard, zoomAround,
  facingSide, type Point, type Rect, type Viewport, MIN_ZOOM,
} from "../../lib/canvas/geometry";
import {
  checkpoint, commit, getCanvasDoc, getViewport, loadCanvas, onCanvasFocusRequest, redo, setViewport,
  takeCanvasFocus, undo, useCanvas,
} from "../../lib/canvas/store";
import { canvasFileRef } from "../../lib/canvas/paths";
import { getCanvasInputMode } from "../../lib/configBridge";
import { openFileInEditor } from "../../lib/openFile";
import { ContextMenu, type MenuSection } from "../ContextMenu";
import { CanvasCard, type CardActions } from "./CanvasCard";
import { CanvasEdges, type EdgeActions } from "./CanvasEdges";
import { NotePicker } from "./NotePicker";

type Tool = "select" | "sticky" | "card" | "label" | "frame";

type Gesture =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean; button: number }
  | { kind: "move"; sx: number; sy: number; origins: Map<string, Point>; moved: boolean }
  | { kind: "resize"; id: string; dir: string; sx: number; sy: number; orig: Rect; moved: boolean }
  | { kind: "marquee"; start: Point; base: Set<string> }
  | { kind: "connect"; from: CanvasNode; side: Side };

const DRAG_THRESHOLD = 4;
const FAR_ZOOM = 0.3;
const MIN_SIZE = 40;

/** Items copied with Cmd+C, shared by every canvas tab */
let clipboard: { nodes: CanvasNode[]; edges: CanvasEdge[] } | null = null;

export function CanvasView({ path, active }: { path: string; active: boolean }) {
  const { doc, error } = useCanvas(path);
  const boardRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const vp = useRef<Viewport>(getViewport(path) ?? { x: 0, y: 0, z: 1 });
  const [view, setView] = useState<Viewport>(vp.current);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const fitted = useRef(!!getViewport(path));

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ type: "node" | "edge"; id: string } | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [stickyColor, setStickyColor] = useState<PaletteName>("yellow");
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [pending, setPending] = useState<{ from: CanvasNode; side: Side; to: Point; toSide: Side | null } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; sections: MenuSection[] } | null>(null);
  const [picker, setPicker] = useState<Point | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);

  useEffect(() => {
    if (!getCanvasDoc(path)) void loadCanvas(path);
  }, [path]);

  // ── Viewport ──

  const applyTransform = useCallback(() => {
    const { x, y, z } = vp.current;
    if (worldRef.current) worldRef.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    const board = boardRef.current;
    if (board) {
      // The dot grid moves and scales with the board, thinning out when zoomed far out
      const step = 24 * z * (z < 0.5 ? 4 : 1);
      board.style.backgroundSize = `${step}px ${step}px`;
      board.style.backgroundPosition = `${x}px ${y}px`;
    }
  }, []);

  const viewTimer = useRef<number | null>(null);
  const setVp = useCallback((next: Viewport) => {
    vp.current = next;
    applyTransform();
    setViewport(path, next);
    // Culling and detail levels follow the view at most ten times a second
    if (viewTimer.current === null) {
      viewTimer.current = window.setTimeout(() => {
        viewTimer.current = null;
        setView({ ...vp.current });
      }, 100);
    }
  }, [applyTransform, path]);

  useLayoutEffect(applyTransform, [applyTransform]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const ro = new ResizeObserver(() => {
      const r = board.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(board);
    return () => ro.disconnect();
  }, []);

  const fitAll = useCallback((d: CanvasDoc | null = getCanvasDoc(path)) => {
    if (!d || !size.width) return;
    setVp(fitViewport(boundsOf(d.nodes), size.width, size.height));
  }, [path, setVp, size]);

  // First open fits the board; later opens restore where it was left
  useEffect(() => {
    if (!fitted.current && doc && size.width) {
      fitted.current = true;
      fitAll(doc);
    }
  }, [doc, size, fitAll]);

  const zoomBy = useCallback((factor: number, at?: Point) => {
    setVp(zoomAround(vp.current, factor, at ?? { x: size.width / 2, y: size.height / 2 }));
  }, [setVp, size]);

  const screenPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = boardRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const boardPoint = (e: { clientX: number; clientY: number }) => toBoard(vp.current, screenPoint(e));

  // A search result asked for an item: centre and select it
  useEffect(() => {
    const focus = () => {
      const d = getCanvasDoc(path);
      if (!d || !size.width) return;
      const id = takeCanvasFocus(path);
      if (!id) return;
      const node = d.nodes.find((n) => n.id === id);
      if (node) {
        setVp(centreOn(node, size.width, size.height, Math.max(0.6, Math.min(1, vp.current.z))));
        setSelection(new Set([id]));
        return;
      }
      const edge = d.edges.find((e) => e.id === id);
      const from = edge && d.nodes.find((n) => n.id === edge.fromNode);
      const to = edge && d.nodes.find((n) => n.id === edge.toNode);
      if (edge && from && to) {
        setVp(centreOn(boundsOf([from, to])!, size.width, size.height, Math.max(0.5, Math.min(1, vp.current.z))));
        setSelectedEdge(edge.id);
      }
    };
    focus();
    return onCanvasFocusRequest(focus);
  }, [path, size, doc !== null, setVp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel and pinch. Mouse mode: the wheel zooms. Trackpad mode: two fingers pan and a
  // pinch zooms. A pinch arrives as WebKit gesture events; Ctrl+wheel is its fallback.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let gestureScale = 1;
    let inGesture = false;
    const onWheel = (e: WheelEvent) => {
      const inside = (e.target as HTMLElement).closest?.("[data-scroll-capture]") as HTMLElement | null;
      if (inside && !e.ctrlKey) {
        // A card being edited or read scrolls its own content until it reaches an end
        const scroller = inside.querySelector(".cm-scroller") as HTMLElement | null;
        if (scroller && scroller.scrollHeight > scroller.clientHeight) return;
      }
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 33 : 1;
      const at = screenPoint(e);
      if (e.ctrlKey) {
        if (!inGesture) zoomBy(Math.exp(-e.deltaY * unit * 0.01), at);
      } else if (getCanvasInputMode() === "mouse" && !e.shiftKey) {
        zoomBy(Math.exp(-e.deltaY * unit * 0.002), at);
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setVp({ ...vp.current, x: vp.current.x - dx * unit, y: vp.current.y - dy * unit });
      }
    };
    const onGestureStart = (e: Event) => { e.preventDefault(); inGesture = true; gestureScale = 1; };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      zoomBy(g.scale / gestureScale, screenPoint(g));
      gestureScale = g.scale;
    };
    const onGestureEnd = (e: Event) => { e.preventDefault(); inGesture = false; };
    board.addEventListener("wheel", onWheel, { passive: false });
    board.addEventListener("gesturestart", onGestureStart);
    board.addEventListener("gesturechange", onGestureChange);
    board.addEventListener("gestureend", onGestureEnd);
    return () => {
      board.removeEventListener("wheel", onWheel);
      board.removeEventListener("gesturestart", onGestureStart);
      board.removeEventListener("gesturechange", onGestureChange);
      board.removeEventListener("gestureend", onGestureEnd);
    };
  }, [zoomBy, setVp]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Document changes ──

  const change = useCallback((fn: (d: CanvasDoc) => CanvasDoc, opts?: { history?: boolean; coalesce?: string }) => {
    const d = getCanvasDoc(path);
    if (d) commit(path, fn(d), opts);
  }, [path]);

  const updateNodes = useCallback((ids: Set<string>, fn: (n: CanvasNode) => CanvasNode, opts?: { history?: boolean; coalesce?: string }) => {
    change((d) => ({ ...d, nodes: d.nodes.map((n) => (ids.has(n.id) ? fn(n) : n)) }), opts);
  }, [change]);

  const updateEdge = useCallback((id: string, fn: (e: CanvasEdge) => CanvasEdge) => {
    change((d) => ({ ...d, edges: d.edges.map((e) => (e.id === id ? fn(e) : e)) }));
  }, [change]);

  const addNode = useCallback((node: CanvasNode, edit = false) => {
    // Frames go to the back so they never cover what they hold
    change((d) => ({ ...d, nodes: node.type === "group" ? [node, ...d.nodes] : [...d.nodes, node] }));
    setSelection(new Set([node.id]));
    setSelectedEdge(null);
    if (edit) setEditing({ type: "node", id: node.id });
  }, [change]);

  const deleteSelection = useCallback(() => {
    if (selectedEdge) {
      change((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== selectedEdge) }));
      setSelectedEdge(null);
    } else if (selection.size) {
      change((d) => withoutNodes(d, selection));
      setSelection(new Set());
    }
  }, [change, selection, selectedEdge]);

  const copySelection = useCallback(() => {
    const d = getCanvasDoc(path);
    if (!d || !selection.size) return false;
    clipboard = {
      nodes: d.nodes.filter((n) => selection.has(n.id)),
      edges: d.edges.filter((e) => selection.has(e.fromNode) && selection.has(e.toNode)),
    };
    return true;
  }, [path, selection]);

  const paste = useCallback((at?: Point) => {
    if (!clipboard?.nodes.length) return;
    const b = boundsOf(clipboard.nodes)!;
    const dx = at ? at.x - b.x : 40, dy = at ? at.y - b.y : 40;
    const ids = new Map(clipboard.nodes.map((n) => [n.id, newId()]));
    const nodes = clipboard.nodes.map((n) => ({ ...n, id: ids.get(n.id)!, x: n.x + dx, y: n.y + dy }));
    const edges = clipboard.edges.map((e) => ({ ...e, id: newId(), fromNode: ids.get(e.fromNode)!, toNode: ids.get(e.toNode)! }));
    change((d) => ({ ...d, nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges] }));
    setSelection(new Set(nodes.map((n) => n.id)));
    clipboard = { nodes, edges };
  }, [change]);

  const reorder = useCallback((toFront: boolean) => {
    change((d) => {
      const picked = d.nodes.filter((n) => selection.has(n.id));
      const rest = d.nodes.filter((n) => !selection.has(n.id));
      return { ...d, nodes: toFront ? [...rest, ...picked] : [...picked, ...rest] };
    });
  }, [change, selection]);

  // ── Actions handed to cards and edges (stable, so memoised cards don't re-render) ──

  const actionsRef = useRef<CardActions & EdgeActions>(null!);
  actionsRef.current = {
    setText: (id, text) => updateNodes(new Set([id]), (n) => ({ ...n, text }), { coalesce: `text:${id}` }),
    setLabel: (id, label) => updateNodes(new Set([id]), (n) => ({ ...n, label })),
    setEdgeLabel: (id, label) => updateEdge(id, (e) => {
      const next: CanvasEdge = { ...e, label };
      if (!label) delete next.label;
      return next;
    }),
    stopEditing: () => {
      setEditing(null);
      boardRef.current?.focus();
    },
    openFile: (p, newTab) => {
      const name = p.split("/").pop() || p;
      void openFileInEditor(p, name, { replaceActive: !newTab });
    },
    openUrl: (url) => { void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)); },
  };
  const actions = useMemo<CardActions & EdgeActions>(() => ({
    setText: (...a) => actionsRef.current.setText(...a),
    setLabel: (...a) => actionsRef.current.setLabel(...a),
    setEdgeLabel: (...a) => actionsRef.current.setEdgeLabel(...a),
    stopEditing: () => actionsRef.current.stopEditing(),
    openFile: (...a) => actionsRef.current.openFile(...a),
    openUrl: (...a) => actionsRef.current.openUrl(...a),
  }), []);

  // Leaving a text item empty removes it, as with a sticky that was never written on
  const stopEditingNode = useCallback((id: string) => {
    const n = getCanvasDoc(path)?.nodes.find((m) => m.id === id);
    if (n && (kindOf(n) === "sticky" || kindOf(n) === "label") && !(n.text ?? "").trim()) {
      change((d) => withoutNodes(d, new Set([id])), { history: false });
      setSelection(new Set());
    }
  }, [change, path]);
  const lastEditing = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastEditing.current;
    lastEditing.current = editing?.type === "node" ? editing.id : null;
    if (prev && prev !== lastEditing.current) stopEditingNode(prev);
  }, [editing, stopEditingNode]);

  // ── Pointer ──

  const startEdit = useCallback((node: CanvasNode) => {
    const k = kindOf(node);
    if (k === "link") actions.openUrl(node.url ?? "");
    else if (k === "sticky" || k === "label" || k === "markdown" || k === "frame") {
      setSelection(new Set([node.id]));
      setEditing({ type: "node", id: node.id });
    }
  }, [actions]);

  const createAt = (t: Tool, p: Point): void => {
    switch (t) {
      case "sticky": addNode(newSticky(p.x - 100, p.y - 100, stickyColor), true); break;
      case "card": addNode(newMarkdownCard(p.x - 180, p.y - 120), true); break;
      case "label": addNode(newLabel(p.x - 20, p.y - 30), true); break;
      case "frame": addNode(newFrame(p.x - 400, p.y - 300)); break;
    }
    setTool("select");
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".canvas-toolbar, .canvas-selection-bar, .canvas-zoom, .canvas-picker")) return;
    setMenu(null);
    // Clicks inside the item being edited belong to its editor
    if (target.closest(".is-editing, .canvas-edge-label-input")) return;
    boardRef.current?.focus();
    if (editing) setEditing(null);

    const d = getCanvasDoc(path);
    if (!d) return;
    const pan = e.button === 1 || e.button === 2 || (e.button === 0 && space.current);
    if (pan) {
      e.preventDefault();
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: vp.current.x, oy: vp.current.y, moved: false, button: e.button };
      return;
    }
    if (e.button !== 0) return;
    const p = boardPoint(e);

    const handle = target.closest("[data-resize]") as HTMLElement | null;
    if (handle) {
      const id = handle.dataset.owner!;
      const n = d.nodes.find((m) => m.id === id);
      if (n) gesture.current = { kind: "resize", id, dir: handle.dataset.resize!, sx: e.clientX, sy: e.clientY, orig: { x: n.x, y: n.y, width: n.width, height: n.height }, moved: false };
      return;
    }
    const connector = target.closest("[data-connect]") as HTMLElement | null;
    if (connector) {
      const n = d.nodes.find((m) => m.id === connector.dataset.owner);
      if (n) {
        const side = connector.dataset.connect as Side;
        gesture.current = { kind: "connect", from: n, side };
        setPending({ from: n, side, to: p, toSide: null });
      }
      return;
    }
    const edgeEl = target.closest("[data-edge-id]") as HTMLElement | null;
    if (edgeEl) {
      setSelectedEdge(edgeEl.dataset.edgeId!);
      setSelection(new Set());
      return;
    }
    const nodeEl = target.closest("[data-node-id]") as HTMLElement | null;
    // A frame is only picked up by its title or border; its inside belongs to the board
    const frameTitle = !!target.closest("[data-frame-title]");
    let node = nodeEl ? d.nodes.find((n) => n.id === nodeEl.dataset.nodeId) ?? null : null;
    if (node?.type === "group" && !frameTitle && !selection.has(node.id)) node = null;

    if (!node) {
      if (tool !== "select") {
        // The browser would move focus to the board after this handler, pulling it out
        // of the new item's text box, which ends the edit and removes the empty item
        e.preventDefault();
        createAt(tool, p);
        return;
      }
      setSelectedEdge(null);
      const base = e.shiftKey ? new Set(selection) : new Set<string>();
      if (!e.shiftKey) setSelection(new Set());
      gesture.current = { kind: "marquee", start: p, base };
      return;
    }

    setSelectedEdge(null);
    let next = selection;
    if (e.shiftKey) {
      next = new Set(selection);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      setSelection(next);
    } else if (!selection.has(node.id)) {
      next = new Set([node.id]);
      setSelection(next);
    }
    // Moving a frame carries what is inside it
    const moving = new Map<string, Point>();
    for (const n of d.nodes) {
      if (!next.has(n.id)) continue;
      moving.set(n.id, { x: n.x, y: n.y });
      if (n.type === "group") for (const inner of nodesInFrame(d.nodes, n)) moving.set(inner.id, { x: inner.x, y: inner.y });
    }
    gesture.current = { kind: "move", sx: e.clientX, sy: e.clientY, origins: moving, moved: false };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const z = vp.current.z;
      if (g.kind === "pan") {
        const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
        if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        g.moved = true;
        setVp({ ...vp.current, x: g.ox + dx, y: g.oy + dy });
      } else if (g.kind === "move") {
        const dx = (e.clientX - g.sx) / z, dy = (e.clientY - g.sy) / z;
        if (!g.moved) {
          if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_THRESHOLD) return;
          g.moved = true;
          checkpoint(path);
        }
        const o = g.origins;
        change((d) => ({ ...d, nodes: d.nodes.map((n) => {
          const from = o.get(n.id);
          return from ? { ...n, x: Math.round(from.x + dx), y: Math.round(from.y + dy) } : n;
        }) }), { history: false });
      } else if (g.kind === "resize") {
        const dx = (e.clientX - g.sx) / z, dy = (e.clientY - g.sy) / z;
        if (!g.moved) { g.moved = true; checkpoint(path); }
        const r = { ...g.orig };
        if (g.dir.includes("e")) r.width = Math.max(MIN_SIZE, g.orig.width + dx);
        if (g.dir.includes("s")) r.height = Math.max(MIN_SIZE, g.orig.height + dy);
        if (g.dir.includes("w")) { r.width = Math.max(MIN_SIZE, g.orig.width - dx); r.x = g.orig.x + g.orig.width - r.width; }
        if (g.dir.includes("n")) { r.height = Math.max(MIN_SIZE, g.orig.height - dy); r.y = g.orig.y + g.orig.height - r.height; }
        const n = getCanvasDoc(path)?.nodes.find((m) => m.id === g.id);
        // Stickies stay square unless Shift is held
        if (n && kindOf(n) === "sticky" && !e.shiftKey) {
          const s = Math.max(r.width, r.height);
          if (g.dir.includes("w")) r.x = g.orig.x + g.orig.width - s;
          if (g.dir.includes("n")) r.y = g.orig.y + g.orig.height - s;
          r.width = r.height = s;
        }
        updateNodes(new Set([g.id]), (m) => ({ ...m, x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }), { history: false });
      } else if (g.kind === "marquee") {
        const r = normaliseRect(g.start, boardPoint(e));
        setMarquee(r);
        const d = getCanvasDoc(path);
        if (!d) return;
        const hit = new Set(g.base);
        for (const n of d.nodes) if (intersects(r, n) && !(n.type === "group" && !contains(r, n))) hit.add(n.id);
        setSelection(hit);
      } else if (g.kind === "connect") {
        const p = boardPoint(e);
        const d = getCanvasDoc(path);
        const over = d ? nodeAt(d.nodes, p, new Set([g.from.id])) : null;
        setPending({ from: g.from, side: g.side, to: over ? anchorFor(over, p) : p, toSide: over ? facingSide(over, p) : null });
      }
    };
    const onUp = (e: PointerEvent) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      if (g.kind === "pan" && !g.moved && g.button === 2) openMenu(e);
      if (g.kind === "marquee") setMarquee(null);
      if (g.kind === "connect") {
        setPending(null);
        const p = boardPoint(e);
        const d = getCanvasDoc(path);
        const over = d ? nodeAt(d.nodes, p, new Set([g.from.id])) : null;
        if (over) {
          const edge = newEdge(g.from.id, g.side, over.id, facingSide(over, p));
          change((doc) => ({ ...doc, edges: [...doc.edges, edge] }));
          setSelectedEdge(edge.id);
          setSelection(new Set());
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }); // re-bound each render so handlers see current state

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".is-editing, .canvas-toolbar, .canvas-selection-bar, .canvas-zoom")) return;
    const d = getCanvasDoc(path);
    if (!d) return;
    const edgeEl = target.closest("[data-edge-id]") as HTMLElement | null;
    if (edgeEl) { setEditing({ type: "edge", id: edgeEl.dataset.edgeId! }); return; }
    const nodeEl = target.closest("[data-node-id]") as HTMLElement | null;
    const node = nodeEl ? d.nodes.find((n) => n.id === nodeEl.dataset.nodeId) : null;
    if (node && (node.type !== "group" || target.closest("[data-frame-title]"))) { startEdit(node); return; }
    createAt(tool === "select" ? "sticky" : tool, boardPoint(e));
  };

  // ── Context menu ──

  const openMenu = (e: { clientX: number; clientY: number; target: EventTarget | null }) => {
    const d = getCanvasDoc(path);
    if (!d) return;
    const p = boardPoint(e);
    const target = e.target as HTMLElement | null;
    const edgeEl = target?.closest?.("[data-edge-id]") as HTMLElement | null;
    const nodeEl = target?.closest?.("[data-node-id]") as HTMLElement | null;
    const sections: MenuSection[] = [];

    if (edgeEl) {
      const edge = d.edges.find((x) => x.id === edgeEl.dataset.edgeId);
      if (edge) {
        setSelectedEdge(edge.id);
        setSelection(new Set());
        sections.push({ id: "edge", items: [
          { id: "label", label: edge.label ? "Edit label" : "Add label", run: () => setEditing({ type: "edge", id: edge.id }) },
          { id: "dash", label: edge.onyx?.dash ? "Solid line" : "Dashed line", run: () => updateEdge(edge.id, (x) => ({ ...x, onyx: { ...x.onyx, dash: !x.onyx?.dash } })) },
          { id: "end", label: (edge.toEnd ?? "arrow") === "arrow" ? "No arrow at end" : "Arrow at end", run: () => updateEdge(edge.id, (x) => ({ ...x, toEnd: (x.toEnd ?? "arrow") === "arrow" ? "none" : "arrow" })) },
          { id: "start", label: edge.fromEnd === "arrow" ? "No arrow at start" : "Arrow at start", run: () => updateEdge(edge.id, (x) => ({ ...x, fromEnd: x.fromEnd === "arrow" ? "none" : "arrow" })) },
          { id: "reverse", label: "Reverse direction", run: () => updateEdge(edge.id, (x) => ({ ...x, fromNode: x.toNode, toNode: x.fromNode, fromSide: x.toSide, toSide: x.fromSide, fromEnd: x.toEnd, toEnd: x.fromEnd })) },
        ] });
        sections.push({ id: "delete", items: [{ id: "delete", label: "Delete", shortcut: "⌫", destructive: true, run: () => change((doc) => ({ ...doc, edges: doc.edges.filter((x) => x.id !== edge.id) })) }] });
      }
    } else if (nodeEl) {
      const node = d.nodes.find((n) => n.id === nodeEl.dataset.nodeId);
      if (node) {
        const ids = selection.has(node.id) ? selection : new Set([node.id]);
        if (!selection.has(node.id)) setSelection(ids);
        const k = kindOf(node);
        const items: MenuSection["items"] = [];
        if (["sticky", "label", "markdown", "frame"].includes(k)) items.push({ id: "edit", label: k === "frame" ? "Rename" : "Edit", shortcut: "↩", run: () => startEdit(node) });
        if (k === "note") items.push({ id: "open", label: "Open note", run: () => { const el = nodeEl.querySelector(".canvas-note-title") as HTMLElement | null; el?.click(); } });
        if (k === "link") items.push({ id: "open", label: "Open link", run: () => actions.openUrl(node.url ?? "") });
        if (k === "label") {
          for (const [label, size] of [["Small text", 20], ["Medium text", 32], ["Large text", 56], ["Huge text", 96]] as const) {
            items.push({ id: `size-${size}`, label, disabled: node.onyx?.fontSize === size, run: () => updateNodes(ids, (n) => ({ ...n, onyx: { ...n.onyx, fontSize: size } })) });
          }
        }
        if (k === "sticky" || k === "markdown") {
          items.push({ id: "convert", label: k === "sticky" ? "Turn into card" : "Turn into sticky", run: () => updateNodes(ids, (n) => {
            const onyx = { ...n.onyx };
            if (k === "sticky") delete onyx.kind; else onyx.kind = "sticky";
            return { ...n, onyx };
          }) });
        }
        sections.push({ id: "item", items });
        sections.push({ id: "order", items: [
          { id: "dup", label: "Duplicate", shortcut: "⌘D", run: () => { if (copySelection()) paste(); } },
          { id: "front", label: "Bring to front", run: () => reorder(true) },
          { id: "back", label: "Send to back", run: () => reorder(false) },
        ] });
        sections.push({ id: "delete", items: [{ id: "delete", label: "Delete", shortcut: "⌫", destructive: true, run: () => { change((doc) => withoutNodes(doc, ids)); setSelection(new Set()); } }] });
      }
    } else {
      setSelection(new Set());
      setSelectedEdge(null);
      sections.push({ id: "add", items: [
        { id: "sticky", label: "Add sticky", shortcut: "N", run: () => createAt("sticky", p) },
        { id: "card", label: "Add card", shortcut: "C", run: () => createAt("card", p) },
        { id: "text", label: "Add text", shortcut: "T", run: () => createAt("label", p) },
        { id: "frame", label: "Add frame", shortcut: "F", run: () => createAt("frame", p) },
      ] });
      sections.push({ id: "insert", items: [
        { id: "note", label: "Add note…", run: () => setPicker(p) },
        { id: "image", label: "Add image…", run: () => void addImage(p) },
        { id: "link", label: "Add link", prompt: "https://…", run: (url) => { if (url) addNode(newLinkCard(url.trim(), p.x - 200, p.y - 40)); } },
      ] });
      sections.push({ id: "board", items: [
        { id: "paste", label: "Paste", shortcut: "⌘V", disabled: !clipboard, run: () => paste(p) },
        { id: "fit", label: "Zoom to fit", shortcut: "⇧1", run: () => fitAll() },
      ] });
    }
    setMenu({ x: e.clientX, y: e.clientY, sections });
  };

  // ── Adding notes and images ──

  const addFile = useCallback(async (abs: string, at: Point, subpath?: string) => {
    const ref = await canvasFileRef(abs, path);
    const node = newFileCard(ref, 0, 0, subpath);
    // An image card takes the picture's proportions, its longer side 400
    const size = kindOf(node) === "image" ? await naturalSize(convertFileSrc(abs)) : null;
    if (size) {
      const k = 400 / Math.max(size.width, size.height);
      node.width = Math.round(size.width * k);
      node.height = Math.round(size.height * k);
    }
    node.x = Math.round(at.x - node.width / 2);
    node.y = Math.round(at.y - node.height / 2);
    addNode(node);
  }, [addNode, path]);

  const addImage = async (at: Point) => {
    const chosen = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic"] }] });
    if (typeof chosen === "string") await addFile(chosen, at);
  };

  const centre = (): Point => toBoard(vp.current, { x: size.width / 2, y: size.height / 2 });

  // Files dragged from the sidebar tree land where they are dropped
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const onDrop = (e: Event) => {
      const { path: file, clientX, clientY } = (e as CustomEvent<{ path: string; clientX: number; clientY: number }>).detail;
      if (file === path) return;
      void addFile(file, toBoard(vp.current, screenPoint({ clientX, clientY })));
    };
    board.addEventListener("canvas-drop", onDrop);
    return () => board.removeEventListener("canvas-drop", onDrop);
  }, [addFile, path]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard ──

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest(".cm-editor, textarea, input")) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const handled = () => { e.preventDefault(); e.stopPropagation(); };

    if (mod && key === "z") { handled(); if (e.shiftKey) redo(path); else undo(path); return; }
    if (mod && key === "y") { handled(); redo(path); return; }
    if (mod && key === "a") { handled(); setSelection(new Set(getCanvasDoc(path)?.nodes.map((n) => n.id))); return; }
    if (mod && key === "c") { if (copySelection()) handled(); return; }
    if (mod && key === "x") { if (copySelection()) { handled(); deleteSelection(); } return; }
    if (mod && key === "v") { if (clipboard) { handled(); paste(); } return; }
    if (mod && key === "d") { handled(); if (copySelection()) paste(); return; }
    if (mod && (key === "=" || key === "+")) { handled(); zoomBy(1.25); return; }
    if (mod && key === "-") { handled(); zoomBy(0.8); return; }
    if (mod && key === "0") { handled(); setVp(zoomAround(vp.current, 1 / vp.current.z, { x: size.width / 2, y: size.height / 2 })); return; }
    if (mod) return;

    if (e.shiftKey && (e.code === "Digit1")) { handled(); fitAll(); return; }
    if (e.shiftKey && (e.code === "Digit0")) { handled(); setVp(zoomAround(vp.current, 1 / vp.current.z, { x: size.width / 2, y: size.height / 2 })); return; }
    if (e.key === "Backspace" || e.key === "Delete") { handled(); deleteSelection(); return; }
    if (e.key === "Escape") { handled(); setSelection(new Set()); setSelectedEdge(null); setTool("select"); return; }
    if (e.key === "Enter" && selection.size === 1) {
      const n = getCanvasDoc(path)?.nodes.find((m) => selection.has(m.id));
      if (n) { handled(); startEdit(n); }
      return;
    }
    if (e.key.startsWith("Arrow") && selection.size) {
      handled();
      const step = e.shiftKey ? 20 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      updateNodes(selection, (n) => ({ ...n, x: n.x + dx, y: n.y + dy }), { coalesce: "nudge" });
      return;
    }
    const tools: Record<string, Tool> = { v: "select", n: "sticky", c: "card", t: "label", f: "frame" };
    if (tools[key]) { handled(); setTool(tools[key]); }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && !(e.target as HTMLElement).closest?.(".cm-editor, textarea, input")) space.current = true; };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") space.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  useEffect(() => {
    if (active) boardRef.current?.focus({ preventScroll: true });
  }, [active]);

  // ── Render ──

  const nodes = doc?.nodes ?? [];
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const visibleArea = useMemo<Rect>(() => {
    const { x, y, z } = view;
    const w = size.width / z, h = size.height / z;
    return { x: -x / z - w / 2, y: -y / z - h / 2, width: w * 2, height: h * 2 };
  }, [view, size]);
  const far = view.z < FAR_ZOOM;
  const scale = Math.pow(1.5, Math.round(Math.log(view.z) / Math.log(1.5)));

  const selectedNodes = nodes.filter((n) => selection.has(n.id));
  const single = selectedNodes.length === 1 && !editing ? selectedNodes[0] : null;
  const selBounds = boundsOf(selectedNodes);
  const edge = selectedEdge ? doc?.edges.find((x) => x.id === selectedEdge) ?? null : null;

  const setColor = (color: string | null) => {
    if (edge) updateEdge(edge.id, (x) => withColor(x, color));
    else updateNodes(selection, (n) => withColor(n, color));
  };
  const currentColor = edge ? colorOf(edge) : single ? colorOf(single) : null;
  const barAt = selBounds
    ? { x: selBounds.x * view.z + view.x + (selBounds.width * view.z) / 2, y: selBounds.y * view.z + view.y }
    : edge ? edgeMid(edge, nodeMap, view) : null;

  if (error) return <div className="canvas-error">This canvas could not be read: {error}</div>;

  return (
    <div
      ref={boardRef}
      className={`canvas-board tool-${tool}`}
      tabIndex={0}
      data-canvas-drop
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      onAuxClick={(e) => e.preventDefault()}
    >
      <div ref={worldRef} className="canvas-world">
        {nodes.filter((n) => n.type === "group" && intersects(n, visibleArea)).map((n) => (
          <CanvasCard key={n.id} node={n} canvasPath={path} selected={selection.has(n.id)}
            editing={editing?.type === "node" && editing.id === n.id} far={far} scale={scale} actions={actions} />
        ))}
        <CanvasEdges nodes={nodeMap} edges={doc?.edges ?? []} selectedEdge={selectedEdge}
          editingEdge={editing?.type === "edge" ? editing.id : null} pending={pending} actions={actions} />
        {nodes.filter((n) => n.type !== "group" && (intersects(n, visibleArea) || selection.has(n.id))).map((n) => (
          <CanvasCard key={n.id} node={n} canvasPath={path} selected={selection.has(n.id)}
            editing={editing?.type === "node" && editing.id === n.id} far={far} scale={scale} actions={actions} />
        ))}
        {selectedNodes.map((n) => <div key={n.id} className="canvas-selection-outline" style={outline(n)} />)}
        {single && <Handles node={single} zoom={view.z} />}
        {marquee && <div className="canvas-marquee" style={outline(marquee)} />}
      </div>

      {!editing && barAt && (selection.size > 0 || edge) && (
        <div className="canvas-selection-bar" style={{ left: barAt.x, top: barAt.y }}>
          {PALETTE.map((c) => (
            <button key={c} className={`canvas-swatch ${currentColor === c ? "is-current" : ""}`}
              style={{ background: cssColor(c) }} title={c} onClick={() => setColor(c)} />
          ))}
          <button className="canvas-swatch is-none" title="No colour" onClick={() => setColor(null)} />
          {edge && (
            <button className={`canvas-bar-button ${edge.onyx?.dash ? "is-on" : ""}`} title="Dashed"
              onClick={() => updateEdge(edge.id, (x) => ({ ...x, onyx: { ...x.onyx, dash: !x.onyx?.dash } }))}>┄</button>
          )}
          <button className="canvas-bar-button" title="Delete" onClick={deleteSelection}><Trash2 size={14} /></button>
        </div>
      )}

      <div className="canvas-toolbar">
        <ToolButton icon={<MousePointer2 size={17} />} label="Select (V)" on={tool === "select"} onClick={() => setTool("select")} />
        <ToolButton icon={<StickyNote size={17} />} label="Sticky (N)" on={tool === "sticky"} onClick={() => setTool("sticky")}
          dot={cssColor(stickyColor)} />
        {tool === "sticky" && (
          <div className="canvas-toolbar-colors">
            {PALETTE.map((c) => (
              <button key={c} className={`canvas-swatch ${stickyColor === c ? "is-current" : ""}`} style={{ background: cssColor(c) }}
                title={c} onClick={() => setStickyColor(c)} />
            ))}
          </div>
        )}
        <ToolButton icon={<RectangleHorizontal size={17} />} label="Card (C)" on={tool === "card"} onClick={() => setTool("card")} />
        <ToolButton icon={<Type size={17} />} label="Text (T)" on={tool === "label"} onClick={() => setTool("label")} />
        <ToolButton icon={<Frame size={17} />} label="Frame (F)" on={tool === "frame"} onClick={() => setTool("frame")} />
        <div className="canvas-toolbar-sep" />
        <ToolButton icon={<FileText size={17} />} label="Add note" onClick={() => setPicker(centre())} />
        <ToolButton icon={<ImageIcon size={17} />} label="Add image" onClick={() => void addImage(centre())} />
        <div className="canvas-toolbar-sep" />
        <ToolButton icon={<Undo2 size={17} />} label="Undo (⌘Z)" onClick={() => undo(path)} />
        <ToolButton icon={<Redo2 size={17} />} label="Redo (⇧⌘Z)" onClick={() => redo(path)} />
      </div>

      <div className="canvas-zoom">
        <button title="Zoom out (⌘−)" onClick={() => zoomBy(0.8)}><Minus size={14} /></button>
        <button className="canvas-zoom-level" title="Zoom to 100% (⇧0)"
          onClick={() => setVp(zoomAround(vp.current, 1 / vp.current.z, { x: size.width / 2, y: size.height / 2 }))}>
          {Math.round(view.z * 100)}%
        </button>
        <button title="Zoom in (⌘=)" onClick={() => zoomBy(1.25)}><Plus size={14} /></button>
        <button title="Zoom to fit (⇧1)" onClick={() => fitAll()}><Maximize size={14} /></button>
      </div>

      {doc && nodes.length === 0 && (
        <div className="canvas-empty">Double-click anywhere to add a sticky, or drag a note in from the sidebar</div>
      )}
      {picker && (
        <NotePicker
          onPick={(file, subpath) => { void addFile(file, picker, subpath); setPicker(null); }}
          onClose={() => { setPicker(null); boardRef.current?.focus(); }}
        />
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function naturalSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function outline(r: Rect): React.CSSProperties {
  return { transform: `translate(${r.x}px, ${r.y}px)`, width: r.width, height: r.height };
}

/** Where a new edge's end sits while hovering a card: the middle of the facing side. */
function anchorFor(n: CanvasNode, p: Point): Point {
  const side = facingSide(n, p);
  switch (side) {
    case "top": return { x: n.x + n.width / 2, y: n.y };
    case "bottom": return { x: n.x + n.width / 2, y: n.y + n.height };
    case "left": return { x: n.x, y: n.y + n.height / 2 };
    case "right": return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

function edgeMid(e: CanvasEdge, nodes: Map<string, CanvasNode>, view: Viewport): Point | null {
  const a = nodes.get(e.fromNode), b = nodes.get(e.toNode);
  if (!a || !b) return null;
  const mx = (a.x + a.width / 2 + b.x + b.width / 2) / 2;
  const my = (a.y + a.height / 2 + b.y + b.height / 2) / 2;
  return { x: mx * view.z + view.x, y: my * view.z + view.y - 20 };
}

/** Resize corners and the four side dots that start an edge, kept a constant screen size. */
function Handles({ node, zoom }: { node: CanvasNode; zoom: number }) {
  const s = 1 / Math.max(zoom, MIN_ZOOM);
  const { x, y, width: w, height: h } = node;
  const corner = (dir: string, cx: number, cy: number) => (
    <div key={dir} className={`canvas-resize canvas-resize-${dir}`} data-resize={dir} data-owner={node.id}
      style={{ transform: `translate(${cx}px, ${cy}px) scale(${s})` }} />
  );
  const dot = (side: Side, cx: number, cy: number) => (
    <div key={side} className="canvas-connect" data-connect={side} data-owner={node.id}
      style={{ transform: `translate(${cx}px, ${cy}px) scale(${s})` }} />
  );
  const gap = 18 * s;
  return (
    <>
      {corner("nw", x, y)}{corner("ne", x + w, y)}{corner("sw", x, y + h)}{corner("se", x + w, y + h)}
      {node.type !== "group" && (
        <>
          {dot("top", x + w / 2, y - gap)}{dot("bottom", x + w / 2, y + h + gap)}
          {dot("left", x - gap, y + h / 2)}{dot("right", x + w + gap, y + h / 2)}
        </>
      )}
    </>
  );
}

function ToolButton({ icon, label, on, onClick, dot }: {
  icon: React.ReactNode; label: string; on?: boolean; onClick: () => void; dot?: string;
}) {
  return (
    <button className={`canvas-tool ${on ? "is-on" : ""}`} title={label} aria-label={label} onClick={onClick}>
      {icon}
      {dot && <span className="canvas-tool-dot" style={{ background: dot }} />}
    </button>
  );
}

