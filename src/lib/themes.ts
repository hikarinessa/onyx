/**
 * Theme system — load themes from CSS custom properties.
 * Themes are defined as objects mapping CSS variable names to values.
 * The active theme is applied by setting properties on :root.
 */

export interface Theme {
  id: string;
  name: string;
  properties: Record<string, string>;
}

const darkTheme: Theme = {
  id: "dark",
  name: "Dark",
  properties: {
    "--bg-base": "#0e0e12",
    "--bg-surface": "#141418",
    "--bg-elevated": "#1a1a20",
    "--bg-hover": "#222228",
    "--bg-active": "#2a2a32",
    "--text-primary": "#e8e8ec",
    "--text-secondary": "#9898a4",
    "--text-tertiary": "#5c5c68",
    "--text-accent": "#8b7cf6",
    "--border-subtle": "#1e1e26",
    "--border-default": "#2a2a34",
    "--border-strong": "#3a3a46",
    "--accent": "#8b7cf6",
    "--accent-hover": "#9d90f8",
    "--accent-muted": "rgba(139, 124, 246, 0.15)",
    "--status-modified": "#e8a44a",
    "--status-error": "#e85454",
    "--status-success": "#4ae88a",
    "--tag-bg": "rgba(139, 124, 246, 0.12)",
    "--tag-text": "#a89cf8",
    "--link-color": "#7ca8f6",
    "--link-broken": "#e87474",
  },
};

const lightTheme: Theme = {
  id: "light",
  name: "Light",
  properties: {
    "--bg-base": "#ffffff",
    "--bg-surface": "#f5f5f7",
    "--bg-elevated": "#eeeef0",
    "--bg-hover": "#e6e6ea",
    "--bg-active": "#dddde2",
    "--text-primary": "#1d1d1f",
    "--text-secondary": "#6e6e73",
    "--text-tertiary": "#9a9aa0",
    "--text-accent": "#6b5ce7",
    "--border-subtle": "#e5e5ea",
    "--border-default": "#d2d2d7",
    "--border-strong": "#c6c6cc",
    "--accent": "#6b5ce7",
    "--accent-hover": "#7d6ff0",
    "--accent-muted": "rgba(107, 92, 231, 0.12)",
    "--status-modified": "#d4851a",
    "--status-error": "#d32f2f",
    "--status-success": "#2e7d32",
    "--tag-bg": "rgba(107, 92, 231, 0.08)",
    "--tag-text": "#6b5ce7",
    "--link-color": "#3366cc",
    "--link-broken": "#d32f2f",
  },
};

const warmTheme: Theme = {
  id: "warm",
  name: "Warm",
  properties: {
    "--bg-base": "#1c1917",
    "--bg-surface": "#221f1c",
    "--bg-elevated": "#292523",
    "--bg-hover": "#332e2b",
    "--bg-active": "#3d3733",
    "--text-primary": "#ede8e3",
    "--text-secondary": "#a8a09a",
    "--text-tertiary": "#6b635d",
    "--text-accent": "#d4a574",
    "--border-subtle": "#2a2522",
    "--border-default": "#38322e",
    "--border-strong": "#483f3a",
    "--accent": "#d4a574",
    "--accent-hover": "#deb88a",
    "--accent-muted": "rgba(212, 165, 116, 0.15)",
    "--status-modified": "#e8a44a",
    "--status-error": "#e85454",
    "--status-success": "#4ae88a",
    "--tag-bg": "rgba(212, 165, 116, 0.12)",
    "--tag-text": "#d4a574",
    "--link-color": "#7eb8d0",
    "--link-broken": "#e87474",
  },
};

const builtInThemes: Theme[] = [darkTheme, lightTheme, warmTheme];
let activeThemeId = "dark";

export function getAvailableThemes(): Theme[] {
  return builtInThemes;
}

export function getActiveThemeId(): string {
  return activeThemeId;
}

export function applyTheme(themeId: string) {
  const theme = builtInThemes.find((t) => t.id === themeId);
  if (!theme) return;

  activeThemeId = themeId;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme.properties)) {
    root.style.setProperty(prop, value);
  }

  // Persist choice
  try {
    localStorage.setItem("onyx-theme", themeId);
  } catch {
    // ignore
  }
}

export function restoreTheme() {
  try {
    const saved = localStorage.getItem("onyx-theme");
    if (saved) {
      applyTheme(saved);
    }
  } catch {
    // ignore
  }
}
