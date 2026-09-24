import { memo, useEffect, useState } from "react";
import { colorOf, cssColor, type CanvasEdge, type CanvasNode, type Side } from "../../lib/canvas/model";
import { anchor, boundsOf, centreOf, edgeGeometry, facingSide, pointOnEdge, type Point } from "../../lib/canvas/geometry";

/** The sides an edge actually uses: its own, or the ones facing the other end. */
export function edgeSides(e: CanvasEdge, from: CanvasNode, to: CanvasNode): [Side, Side] {
  return [e.fromSide ?? facingSide(from, centreOf(to)), e.toSide ?? facingSide(to, centreOf(from))];
}

function arrowHead(tip: Point, towards: Point, size: number): string {
  const dx = tip.x - towards.x, dy = tip.y - towards.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const bx = tip.x - ux * size, by = tip.y - uy * size;
  const w = size * 0.55;
  return `M${tip.x},${tip.y} L${bx - uy * w},${by + ux * w} L${bx + uy * w},${by - ux * w} Z`;
}

export interface EdgeActions {
  setEdgeLabel: (id: string, label: string) => void;
  stopEditing: (id?: string) => void;
}

interface Props {
  nodes: Map<string, CanvasNode>;
  edges: CanvasEdge[];
  selectedEdge: string | null;
  editingEdge: string | null;
  /** An edge being dragged out of a card's side */
  pending: { from: CanvasNode; side: Side; to: Point; toSide: Side | null } | null;
  actions: EdgeActions;
}

function EdgesImpl({ nodes, edges, selectedEdge, editingEdge, pending, actions }: Props) {
  const drawn = edges.map((e) => {
    const from = nodes.get(e.fromNode), to = nodes.get(e.toNode);
    if (!from || !to) return null;
    const [fs, ts] = edgeSides(e, from, to);
    const g = edgeGeometry(anchor(from, fs), fs, anchor(to, ts), ts);
    const color = colorOf(e);
    // Palette colours are paper tints; lines take them darker (or lighter) toward the text colour
    return { e, g, stroke: color ? `color-mix(in oklab, ${cssColor(color)} 65%, var(--text-primary))` : "var(--canvas-edge)" };
  }).filter((x): x is NonNullable<typeof x> => !!x);

  // The layer covers every card plus a margin: WebKit doesn't hit-test SVG content
  // outside its box, and edges must stay clickable wherever they run.
  const box = boundsOf([...nodes.values()]) ?? { x: 0, y: 0, width: 0, height: 0 };
  const m = 2000;
  const frame = { x: box.x - m, y: box.y - m, width: box.width + m * 2, height: box.height + m * 2 };

  return (
    <>
      <svg
        className="canvas-edges"
        style={{ transform: `translate(${frame.x}px, ${frame.y}px)` }}
        width={frame.width}
        height={frame.height}
        viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
      >
        {drawn.map(({ e, g, stroke }) => {
          const selected = e.id === selectedEdge;
          const arrowEnd = (e.toEnd ?? "arrow") === "arrow";
          const arrowStart = e.fromEnd === "arrow";
          return (
            <g key={e.id} className={`canvas-edge ${selected ? "is-selected" : ""}`} style={{ color: stroke }}>
              <path d={g.d} className="canvas-edge-hit" data-edge-id={e.id} />
              <path d={g.d} className="canvas-edge-line" strokeDasharray={e.onyx?.dash ? "10 7" : undefined} />
              {arrowEnd && <path d={arrowHead(g.end, pointOnEdge(g, 0.92), 14)} className="canvas-edge-arrow" />}
              {arrowStart && <path d={arrowHead(g.start, pointOnEdge(g, 0.08), 14)} className="canvas-edge-arrow" />}
            </g>
          );
        })}
        {pending && (() => {
          const start = anchor(pending.from, pending.side);
          const g = edgeGeometry(start, pending.side, pending.to, pending.toSide);
          return (
            <g className="canvas-edge is-pending">
              <path d={g.d} className="canvas-edge-line" />
              <path d={arrowHead(g.end, pointOnEdge(g, 0.92), 14)} className="canvas-edge-arrow" />
            </g>
          );
        })()}
      </svg>
      {drawn.map(({ e, g }) => (e.label || e.id === editingEdge) && (
        <EdgeLabel
          key={e.id}
          edge={e}
          at={g.mid}
          editing={e.id === editingEdge}
          selected={e.id === selectedEdge}
          actions={actions}
        />
      ))}
    </>
  );
}

export const CanvasEdges = memo(EdgesImpl);

function EdgeLabel({ edge, at, editing, selected, actions }: {
  edge: CanvasEdge; at: Point; editing: boolean; selected: boolean; actions: EdgeActions;
}) {
  const [draft, setDraft] = useState(edge.label ?? "");
  useEffect(() => setDraft(edge.label ?? ""), [edge.label, editing]);
  const style = { transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)` };
  if (!editing) {
    return (
      <div className={`canvas-edge-label ${selected ? "is-selected" : ""}`} style={style} data-edge-id={edge.id}>
        {edge.label}
      </div>
    );
  }
  return (
    <input
      className="canvas-edge-label canvas-edge-label-input"
      style={style}
      autoFocus
      value={draft}
      placeholder="Label"
      size={Math.max(6, draft.length + 1)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { actions.setEdgeLabel(edge.id, draft.trim()); actions.stopEditing(edge.id); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(edge.label ?? ""); actions.stopEditing(edge.id); }
      }}
    />
  );
}
