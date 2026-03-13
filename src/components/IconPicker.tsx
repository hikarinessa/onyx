import { useState, useEffect, useRef, useMemo } from "react";
import { Icon } from "./Icon";
import { ICON_CATEGORIES, ALL_ICON_NAMES } from "../lib/iconCatalog";

interface IconPickerProps {
  currentIcon: string;
  onSelect: (icon: string) => void;
  onClose: () => void;
}

export function IconPicker({ currentIcon, onSelect, onClose }: IconPickerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q && !activeCategory) return ICON_CATEGORIES;
    if (!q && activeCategory) {
      return ICON_CATEGORIES.filter((c) => c.name === activeCategory);
    }
    // Search across all icons
    const matching = ALL_ICON_NAMES.filter((name) => name.includes(q));
    if (matching.length === 0) return [];
    return [{ name: "Results", icons: matching }];
  }, [search, activeCategory]);

  return (
    <div className="icon-picker-overlay" onClick={onClose}>
      <div className="icon-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="icon-picker-header">
          <input
            ref={inputRef}
            type="text"
            className="icon-picker-search"
            placeholder="Search icons..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (e.target.value) setActiveCategory(null);
            }}
          />
        </div>
        <div className="icon-picker-categories">
          <button
            className={`icon-picker-cat-btn ${!activeCategory ? "active" : ""}`}
            onClick={() => setActiveCategory(null)}
          >
            All
          </button>
          {ICON_CATEGORIES.map((cat) => (
            <button
              key={cat.name}
              className={`icon-picker-cat-btn ${activeCategory === cat.name ? "active" : ""}`}
              onClick={() => {
                setActiveCategory(cat.name);
                setSearch("");
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>
        <div className="icon-picker-body">
          {filtered.map((cat) => (
            <div key={cat.name} className="icon-picker-section">
              <div className="icon-picker-section-title">{cat.name}</div>
              <div className="icon-picker-grid">
                {cat.icons.map((name) => (
                  <button
                    key={name}
                    className={`icon-picker-item ${name === currentIcon ? "selected" : ""}`}
                    title={name}
                    onClick={() => onSelect(name)}
                  >
                    <Icon name={name} size={18} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="icon-picker-empty">No icons found</div>
          )}
        </div>
      </div>
    </div>
  );
}
