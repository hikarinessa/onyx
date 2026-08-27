import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A generic right-click menu driven by data rather than props-per-action.
 *
 * Every surface that wants a menu describes it as a list of sections, each a list of
 * items; the component only positions, dismisses and dispatches. Anything that was
 * hard-wired into a bespoke menu — the sidebar's, the calendar's — can move onto this
 * without the component learning what a file or a date is.
 */

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Runs on selection. A `prompt` item receives the entered text instead. */
  run: (input?: string) => void;
  /** Ask for text before running — the label becomes the prompt's placeholder. */
  prompt?: string;
}

export interface MenuSection {
  id: string;
  items: MenuItem[];
}

export interface ContextMenuProps {
  x: number;
  y: number;
  sections: MenuSection[];
  onClose: () => void;
}

/** Keep the menu inside the viewport, flipping it up/left when it would overflow. */
function clamp(x: number, y: number, el: HTMLElement | null): { left: number; top: number } {
  if (!el) return { left: x, top: y };
  const { width, height } = el.getBoundingClientRect();
  const margin = 8;
  const left = x + width + margin > window.innerWidth ? Math.max(margin, x - width) : x;
  const top = y + height + margin > window.innerHeight ? Math.max(margin, y - height) : y;
  return { left, top };
}

export function ContextMenu({ x, y, sections, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [prompting, setPrompting] = useState<MenuItem | null>(null);
  const [draft, setDraft] = useState("");

  useLayoutEffect(() => {
    setPos(clamp(x, y, ref.current));
  }, [x, y, prompting]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Capture phase, so a click that lands on the editor closes the menu before
    // CodeMirror gets to move the caret.
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const visible = sections.filter((s) => s.items.length > 0);
  if (visible.length === 0) return null;

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    if (item.prompt) {
      setPrompting(item);
      setDraft("");
      return;
    }
    onClose();
    item.run();
  };

  const submit = () => {
    if (!prompting || !draft.trim()) return;
    const item = prompting;
    const text = draft;
    onClose();
    item.run(text);
  };

  return (
    <div
      ref={ref}
      className="context-menu editor-context-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {prompting ? (
        <div className="context-menu-prompt">
          <div className="context-menu-prompt-label">{prompting.label}</div>
          <textarea
            autoFocus
            rows={2}
            value={draft}
            placeholder={prompting.prompt}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setPrompting(null);
              }
            }}
          />
          <div className="context-menu-prompt-actions">
            <button className="primary" onClick={submit} disabled={!draft.trim()}>
              OK
            </button>
            <button onClick={() => setPrompting(null)}>Back</button>
          </div>
        </div>
      ) : (
        visible.map((section, i) => (
          <div key={section.id}>
            {i > 0 && <div className="context-menu-separator" />}
            {section.items.map((item) => (
              <div
                key={item.id}
                className={[
                  "context-menu-item",
                  item.destructive ? "destructive" : "",
                  item.disabled ? "disabled" : "",
                ].join(" ")}
                onClick={() => choose(item)}
              >
                <span className="context-menu-label">{item.label}</span>
                {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
