import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { colorOf, cssColor, kindOf, type CanvasNode } from "../../lib/canvas/model";
import { useNoteContent } from "../../lib/canvas/noteContent";
import { resolveImageSrc } from "../../lib/imageRefs";
import { renderInline } from "../../extensions/embeds";
import { CardEditor } from "./CardEditor";

export interface CardActions {
  setText: (id: string, text: string) => void;
  setLabel: (id: string, label: string) => void;
  stopEditing: () => void;
  openFile: (path: string, newTab: boolean) => void;
  openUrl: (url: string) => void;
}

export interface CardProps {
  node: CanvasNode;
  canvasPath: string;
  selected: boolean;
  editing: boolean;
  /** Zoomed out far enough that cards show a summary instead of rendered markdown */
  far: boolean;
  /** Screen pixels per board pixel, rounded to a step, for choosing image resolution */
  scale: number;
  actions: CardActions;
}

function CardImpl({ node, canvasPath, selected, editing, far, scale, actions }: CardProps) {
  const kind = kindOf(node);
  const color = colorOf(node);
  const style: React.CSSProperties = {
    transform: `translate(${node.x}px, ${node.y}px)`,
    width: node.width,
    height: node.height,
  };
  if (color) (style as Record<string, string>)["--item-color"] = cssColor(color);
  const cls = [
    "canvas-item",
    `canvas-${kind}`,
    color ? "has-color" : "",
    selected ? "is-selected" : "",
    editing ? "is-editing" : "",
  ].filter(Boolean).join(" ");

  let body: React.ReactNode;
  switch (kind) {
    case "frame":
      body = <FrameTitle node={node} editing={editing} actions={actions} />;
      break;
    case "sticky":
    case "label":
      body = <TextItem node={node} editing={editing} fit={kind === "sticky"} actions={actions} />;
      break;
    case "markdown":
      body = far && !editing
        ? <Summary text={node.text ?? ""} />
        : <CardEditor
            text={node.text ?? ""}
            contextPath={canvasPath}
            editing={editing}
            onChange={(t) => actions.setText(node.id, t)}
            onExit={actions.stopEditing}
          />;
      break;
    case "note":
      body = <NoteCard node={node} canvasPath={canvasPath} far={far} actions={actions} />;
      break;
    case "image":
      body = <ImageCard node={node} canvasPath={canvasPath} scale={scale} />;
      break;
    case "link":
      body = (
        <div className="canvas-link-body">
          <div className="canvas-link-host">{hostOf(node.url ?? "")}</div>
          <div className="canvas-link-url">{node.url}</div>
        </div>
      );
      break;
    default:
      body = <div className="canvas-file-body">{node.file?.split("/").pop()}</div>;
  }

  return (
    <div className={cls} style={style} data-node-id={node.id} data-scroll-capture={editing || (selected && (kind === "markdown" || kind === "note")) || undefined}>
      {body}
    </div>
  );
}

export const CanvasCard = memo(CardImpl);

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function Summary({ text }: { text: string }) {
  const lines = text.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n").filter((l) => l.trim()).slice(0, 12);
  return (
    <div className="canvas-summary">
      {lines.map((l, i) => <div key={i} className={/^#{1,6}\s/.test(l) ? "is-heading" : ""}>{l.replace(/^#{1,6}\s+/, "")}</div>)}
    </div>
  );
}

// ── Stickies and labels ──

const MIN_FONT = 9;
const MAX_FONT = 72;

/** Largest font size (whole pixels) at which `el`'s content fits its box. */
function fitFont(el: HTMLElement): number {
  let lo = MIN_FONT, hi = MAX_FONT;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) lo = mid;
    else hi = mid - 1;
  }
  el.style.fontSize = `${lo}px`;
  return lo;
}

function TextItem({ node, editing, fit, actions }: {
  node: CanvasNode; editing: boolean; fit: boolean; actions: CardActions;
}) {
  const text = node.text ?? "";
  const measureRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [fontSize, setFontSize] = useState<number>(fit ? 24 : node.onyx?.fontSize ?? 32);

  // Stickies size their text to the box, like a marker on a post-it
  useLayoutEffect(() => {
    if (!fit || !measureRef.current) return;
    setFontSize(fitFont(measureRef.current));
  }, [fit, text, node.width, node.height]);

  useEffect(() => {
    if (!fit) setFontSize(node.onyx?.fontSize ?? 32);
  }, [fit, node.onyx?.fontSize]);

  useEffect(() => {
    if (!editing) return;
    // After the click that started editing has finished, so nothing takes focus back
    const frame = requestAnimationFrame(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  return (
    <>
      <div
        ref={measureRef}
        className="canvas-text"
        style={{ fontSize, visibility: editing ? "hidden" : undefined }}
        dangerouslySetInnerHTML={{ __html: text ? text.split("\n").map(renderInline).join("<br>") : "" }}
      />
      {editing && (
        <textarea
          ref={areaRef}
          className="canvas-text canvas-text-input"
          style={{ fontSize }}
          value={text}
          spellCheck
          onChange={(e) => actions.setText(node.id, e.target.value)}
          onBlur={actions.stopEditing}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              actions.stopEditing();
            }
          }}
        />
      )}
    </>
  );
}

// ── Frames ──

function FrameTitle({ node, editing, actions }: { node: CanvasNode; editing: boolean; actions: CardActions }) {
  const [draft, setDraft] = useState(node.label ?? "");
  useEffect(() => setDraft(node.label ?? ""), [node.label, editing]);
  if (!editing) return <div className="canvas-frame-title" data-frame-title>{node.label || "Frame"}</div>;
  return (
    <input
      className="canvas-frame-title canvas-frame-title-input"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { actions.setLabel(node.id, draft.trim()); actions.stopEditing(); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(node.label ?? ""); actions.stopEditing(); }
      }}
    />
  );
}

// ── Note cards ──

function NoteCard({ node, canvasPath, far, actions }: {
  node: CanvasNode; canvasPath: string; far: boolean; actions: CardActions;
}) {
  const note = useNoteContent(node.file ?? "", node.subpath ?? null, canvasPath);
  const name = (node.file ?? "").split("/").pop()?.replace(/\.md$/i, "");
  return (
    <>
      <div
        className="canvas-note-title"
        title="Open note (Cmd-click: new tab)"
        onClick={(e) => { if (note.path) actions.openFile(note.path, e.metaKey); }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {name}
        {node.subpath && <span className="canvas-note-subpath">{node.subpath}</span>}
      </div>
      <div className="canvas-note-body">
        {note.status === "missing" && <div className="canvas-note-missing">{note.error}</div>}
        {note.status === "ready" && (far
          ? <Summary text={note.text} />
          : <CardEditor text={note.text} contextPath={note.path ?? canvasPath} editing={false} />)}
      </div>
    </>
  );
}

// ── Images ──

/**
 * A photo drawn into a canvas about twice its card's size, so zooming never rescales a
 * 12-megapixel original; the original loads only when zoomed in past the copy.
 */
function ImageCard({ node, canvasPath, scale }: { node: CanvasNode; canvasPath: string; scale: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [thumbWidth, setThumbWidth] = useState(0);
  const file = node.file ?? "";

  useEffect(() => {
    let alive = true;
    const direct = file.startsWith("/") ? convertFileSrc(file) : null;
    (direct ? Promise.resolve(direct) : resolveImageSrc(file, canvasPath)).then((s) => {
      if (!alive) return;
      if (s) setSrc(s);
      else setMissing(true);
    });
    return () => { alive = false; };
  }, [file, canvasPath]);

  const target = Math.min(2048, Math.ceil(Math.max(node.width, node.height) * 2));
  useEffect(() => {
    if (!src || file.toLowerCase().endsWith(".svg")) return;
    let alive = true;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    img.decode().then(() => {
      const canvas = canvasRef.current;
      if (!alive || !canvas) return;
      const ratio = Math.min(1, target / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setThumbWidth(canvas.width);
    }).catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [src, target, file]);

  if (missing) return <div className="canvas-file-body">Image not found: {file.split("/").pop()}</div>;
  const needsOriginal = file.toLowerCase().endsWith(".svg") ||
    (thumbWidth > 0 && node.width * scale * window.devicePixelRatio > thumbWidth * 1.25);
  return (
    <>
      <canvas ref={canvasRef} className="canvas-image" style={{ display: needsOriginal ? "none" : undefined }} />
      {needsOriginal && src && <img className="canvas-image" src={src} draggable={false} alt="" />}
    </>
  );
}
