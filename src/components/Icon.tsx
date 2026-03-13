import { ICON_MAP } from "../lib/iconCatalog";

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, className, strokeWidth = 1.75 }: IconProps) {
  const LucideComponent = ICON_MAP[name];
  if (!LucideComponent) return null;
  return (
    <LucideComponent
      size={size}
      className={className}
      strokeWidth={strokeWidth}
    />
  );
}
