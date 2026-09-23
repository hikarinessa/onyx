import { useState, useEffect, useRef, useMemo } from "react";
import { TREE_ICON_MAP, TREE_ICON_CATEGORIES, ALL_TREE_ICON_NAMES } from "../lib/treeIconCatalog";
import { PALETTE, resolveColor, resolveIconName } from "../lib/treeStyles";

interface IconPickerProps {
  /** Name of the file or folder being styled, shown in the header. */
  title: string;
  icon: string | null;
  color: string | null;
  /** Icon shown when none is set; also highlighted as the current choice then. */
  fallbackIcon: string;
  /** Roots always carry a colour (it draws their stripe); tree entries may have none. */
  allowNoColor: boolean;
  onIconChange: (icon: string) => void;
  onColorChange: (color: string | null) => void;
  /** Clears icon and colour; omitted where there is nothing to clear to. */
  onReset?: () => void;
  onClose: () => void;
}

const CUSTOM_COMMIT_MS = 250;

export function IconPicker({
  title, icon, color, fallbackIcon, allowNoColor, onIconChange, onColorChange, onReset, onClose,
}: IconPickerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // Colour is applied live while the picker stays open, so it is held here and
  // pushed out; the macOS colour panel fires input on every drag step, hence the delay.
  const [liveColor, setLiveColor] = useState(color);
  const customTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentIcon = resolveIconName(icon) ?? fallbackIcon;
  const tint = resolveColor(liveColor);
  const isCustom = !!liveColor?.startsWith("#");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => () => clearTimeout(customTimer.current), []);

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

  const pickColor = (next: string | null) => {
    clearTimeout(customTimer.current);
    setLiveColor(next);
    onColorChange(next);
  };

  const pickCustom = (hex: string) => {
    setLiveColor(hex);
    clearTimeout(customTimer.current);
    customTimer.current = setTimeout(() => onColorChange(hex), CUSTOM_COMMIT_MS);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q && !activeCategory) return TREE_ICON_CATEGORIES;
    if (!q && activeCategory) {
      return TREE_ICON_CATEGORIES.filter((c) => c.name === activeCategory);
    }
    const matching = ALL_TREE_ICON_NAMES.filter((name) => name.includes(q));
    if (matching.length === 0) return [];
    return [{ name: "Results", icons: matching }];
  }, [search, activeCategory]);

  return (
    <div className="icon-picker-overlay" onClick={onClose}>
      <div className="icon-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="icon-picker-header">
          <div className="icon-picker-title" title={title}>{title}</div>
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
        <div className="icon-picker-colors">
          {allowNoColor && (
            <button
              className={`icon-picker-swatch icon-picker-swatch-none ${!liveColor ? "selected" : ""}`}
              title="No colour"
              onClick={() => pickColor(null)}
            />
          )}
          {PALETTE.map((p) => (
            <button
              key={p.name}
              className={`icon-picker-swatch ${liveColor === p.name ? "selected" : ""}`}
              style={{ background: `var(--tree-color-${p.name})` }}
              title={p.name}
              onClick={() => pickColor(p.name)}
            />
          ))}
          <label
            className={`icon-picker-swatch icon-picker-swatch-custom ${isCustom ? "selected" : ""}`}
            style={isCustom ? { background: liveColor! } : undefined}
            title="Custom colour"
          >
            <input
              type="color"
              value={isCustom ? liveColor! : "#888888"}
              onChange={(e) => pickCustom(e.target.value)}
            />
          </label>
          {onReset && (
            <button className="icon-picker-reset" onClick={onReset}>Reset</button>
          )}
        </div>
        <div className="icon-picker-categories">
          <button
            className={`icon-picker-cat-btn ${!activeCategory ? "active" : ""}`}
            onClick={() => setActiveCategory(null)}
          >
            All
          </button>
          {TREE_ICON_CATEGORIES.map((cat) => (
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
        <div className="icon-picker-body" style={tint ? { color: tint } : undefined}>
          {filtered.map((cat) => (
            <div key={cat.name} className="icon-picker-section">
              <div className="icon-picker-section-title">{cat.name}</div>
              <div className="icon-picker-grid">
                {cat.icons.map((name) => {
                  const Glyph = TREE_ICON_MAP[name];
                  return (
                    <button
                      key={name}
                      className={`icon-picker-item ${name === currentIcon ? "selected" : ""} ${tint ? "tinted" : ""}`}
                      title={name}
                      onClick={() => onIconChange(name)}
                    >
                      <Glyph size={20} weight="duotone" />
                    </button>
                  );
                })}
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
