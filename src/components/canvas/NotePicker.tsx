import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Hit { path: string; title: string | null }

/**
 * Pick a note to put on the board. `name#Heading` places just that section.
 */
export function NotePicker({ onPick, onClose }: { onPick: (path: string, subpath?: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const hash = query.indexOf("#");
  const name = (hash < 0 ? query : query.slice(0, hash)).trim();
  const subpath = hash < 0 ? undefined : query.slice(hash + 1).trim() || undefined;

  useEffect(() => {
    let alive = true;
    if (!name) { setHits([]); return; }
    invoke<Hit[]>("search_files", { query: name })
      .then((h) => { if (alive) { setHits(h.filter((x) => x.path.endsWith(".md")).slice(0, 12)); setIndex(0); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [name]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  return (
    <div className="canvas-picker" ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={query}
        placeholder="Note name, or name#Heading for one section"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
          if (e.key === "Enter" && hits[index]) onPick(hits[index].path, subpath);
        }}
      />
      <div className="canvas-picker-results">
        {hits.map((h, i) => (
          <div key={h.path} className={`canvas-picker-item ${i === index ? "is-active" : ""}`}
            onMouseEnter={() => setIndex(i)} onClick={() => onPick(h.path, subpath)}>
            <span>{h.title ?? h.path.split("/").pop()?.replace(/\.md$/, "")}</span>
            <span className="canvas-picker-path">{h.path.split("/").slice(-3, -1).join("/")}</span>
          </div>
        ))}
        {name && !hits.length && <div className="canvas-picker-empty">No matching notes</div>}
      </div>
    </div>
  );
}
