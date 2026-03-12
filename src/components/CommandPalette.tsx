import { useState, useEffect, useRef, useCallback } from "react";
import { useAppStore } from "../stores/app";
import { getAllCommands, fuzzyMatch, type Command } from "../lib/commands";

export function CommandPalette() {
  const visible = useAppStore((s) => s.commandPaletteVisible);
  const setVisible = useAppStore((s) => s.setCommandPaletteVisible);

  const [query, setQuery] = useState("");
  const [filtered, setFiltered] = useState<Command[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelectedIndex(0);
      setFiltered(getAllCommands());
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const all = getAllCommands();
    if (query.trim() === "") {
      setFiltered(all);
    } else {
      setFiltered(all.filter((c) => fuzzyMatch(query, c.label)));
    }
    setSelectedIndex(0);
  }, [query, visible]);

  const close = useCallback(() => setVisible(false), [setVisible]);

  const execute = useCallback(
    (cmd: Command) => {
      close();
      // Defer execution so the palette closes first
      requestAnimationFrame(() => cmd.execute());
    },
    [close]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          execute(filtered[selectedIndex]);
        }
        return;
      }
    },
    [filtered, selectedIndex, execute, close]
  );

  if (!visible) return null;

  // Group commands by category
  let currentCategory = "";

  return (
    <div className="quick-open-overlay" onClick={close} onKeyDown={(e) => { if (e.key === "Tab") e.preventDefault(); }}>
      <div className="quick-open command-palette" role="dialog" aria-label="Command Palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="quick-open-input"
          type="text"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="quick-open-results">
          {filtered.length === 0 && query.trim() !== "" && (
            <div className="command-palette-empty">No matching commands</div>
          )}
          {filtered.map((cmd, i) => {
            const showCategory = cmd.category !== currentCategory;
            currentCategory = cmd.category;
            return (
              <div key={cmd.id}>
                {showCategory && (
                  <div className="command-palette-category" role="separator" aria-label={cmd.category}>{cmd.category}</div>
                )}
                <div
                  className={`quick-open-item command-palette-item ${
                    i === selectedIndex ? "selected" : ""
                  }`}
                  onClick={() => execute(cmd)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="quick-open-item-name">{cmd.label}</span>
                  {cmd.shortcut && (
                    <span className="command-palette-shortcut">
                      {cmd.shortcut}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
