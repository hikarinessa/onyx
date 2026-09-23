import { TREE_ICON_MAP } from "../lib/treeIconCatalog";
import { resolveColor, resolveIconName } from "../lib/treeStyles";

interface TreeIconProps {
  /** Stored icon name; falls back to `fallback` when unset or unknown. */
  name?: string | null;
  fallback: string;
  color?: string | null;
  size?: number;
}

/** A file-tree icon: Phosphor duotone, tinted by the entry's colour if it has one. */
export function TreeIcon({ name, fallback, color, size = 16 }: TreeIconProps) {
  const Component = TREE_ICON_MAP[resolveIconName(name) ?? fallback];
  if (!Component) return null;
  const css = resolveColor(color);
  return <Component size={size} weight="duotone" style={css ? { color: css } : undefined} />;
}
