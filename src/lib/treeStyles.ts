/**
 * Icon and colour for tree entries.
 *
 * A colour is either a palette name ("teal") or a custom "#rrggbb". Palette colours
 * share one OKLCH lightness and chroma per theme (`--tree-hue-l`, `--tree-hue-c` in
 * theme.css), so every hue reads equally bright and follows a theme switch; a custom
 * colour is used exactly as picked.
 */
import { TREE_ICON_MAP } from "./treeIconCatalog";

/** Per-path style, as stored in ~/.onyx/tree-styles.json. */
export interface TreeStyle {
  icon?: string | null;
  color?: string | null;
}

export const PALETTE: { name: string; hue: number }[] = [
  { name: "red", hue: 25 },
  { name: "orange", hue: 55 },
  { name: "amber", hue: 85 },
  { name: "lime", hue: 125 },
  { name: "green", hue: 150 },
  { name: "teal", hue: 180 },
  { name: "cyan", hue: 215 },
  { name: "blue", hue: 255 },
  { name: "violet", hue: 295 },
  { name: "pink", hue: 345 },
];

/** Colour for the n-th registered directory, cycling through the palette. */
export function defaultDirColor(index: number): string {
  // Step by 3 so neighbouring roots land far apart on the wheel
  return PALETTE[(index * 3) % PALETTE.length].name;
}

/** CSS colour for a stored value, or undefined to inherit. */
export function resolveColor(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  if (color.startsWith("#")) return color;
  return PALETTE.some((p) => p.name === color) ? `var(--tree-color-${color})` : undefined;
}

/** Lucide names saved by the earlier picker whose Phosphor name differs. */
const LUCIDE_ALIASES: Record<string, string> = {
  "folder-heart": "folder-star",
  "folder-git": "git-branch",
  "folder-tree": "tree-structure",
  "file-json": "file-code",
  "file-archive": "file-zip",
  "file-spreadsheet": "file-csv",
  "library": "books",
  "scroll-text": "scroll",
  "search": "magnifying-glass",
  "settings": "gear",
  "mail": "envelope",
  "home": "house",
  "zap": "lightning",
  "flame": "fire",
  "sparkles": "sparkle",
  "tree-pine": "tree-evergreen",
  "mountain": "mountains",
  "flask-conical": "flask",
  "message-square": "chat-circle",
  "message-circle": "chat-circle",
  "gamepad-2": "game-controller",
  "music": "music-note",
  "mic": "microphone",
  "video": "video-camera",
  "film": "film-strip",
  "tv": "television",
  "utensils-crossed": "fork-knife",
  "plane": "airplane",
  "bike": "bicycle",
  "ship": "boat",
  "alert-triangle": "warning",
  "alert-circle": "warning-circle",
  "help-circle": "question",
  "server": "hard-drives",
  "monitor": "desktop",
  "smartphone": "device-mobile",
  "terminal": "terminal-window",
  "code-2": "code",
};

/** Phosphor name to render for a stored icon name, or null if none matches. */
export function resolveIconName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (TREE_ICON_MAP[name]) return name;
  const alias = LUCIDE_ALIASES[name];
  return alias && TREE_ICON_MAP[alias] ? alias : null;
}
