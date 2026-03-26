import { reapplyStyleOverrides } from "./configBridge";

export interface Theme {
  id: string;
  name: string;
}

const builtInThemes: Theme[] = [
  { id: "dark", name: "Dark" },
  { id: "light", name: "Light" },
  { id: "cream", name: "Cream" },
  { id: "sakura", name: "Sakura" },
  { id: "velvet", name: "Velvet" },
  { id: "reef", name: "Reef" },
  { id: "midnight", name: "Midnight" },
];
let activeThemeId = "dark";

export function getAvailableThemes(): Theme[] {
  return builtInThemes;
}

export function getActiveThemeId(): string {
  return activeThemeId;
}

// Migrate removed/renamed theme IDs — old dark → midnight, old warm2 → dark
const THEME_MIGRATION: Record<string, string> = {
  warm2: "dark",
  warm: "dark",
  catppuccin: "midnight",
  nord: "midnight",
  "rose-pine": "midnight",
  dracula: "midnight",
  gruvbox: "dark",
  campfire: "dark",
  aurora: "midnight",
  sandstorm: "dark",
  noir: "midnight",
};

export function applyTheme(themeId: string) {
  const migrated = THEME_MIGRATION[themeId];
  if (migrated) themeId = migrated;
  const theme = builtInThemes.find((t) => t.id === themeId);
  if (!theme) return;

  activeThemeId = themeId;
  if (themeId === "dark") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = themeId;
  }
  reapplyStyleOverrides();

  try {
    localStorage.setItem("onyx-theme", themeId);
  } catch {
    // ignore
  }
}

export function restoreTheme(configTheme?: string) {
  try {
    const saved = localStorage.getItem("onyx-theme");
    if (saved) {
      // One-time migration: old "dark" (blue-purple) is now "midnight"
      if (saved === "dark" && !localStorage.getItem("onyx-theme-migrated")) {
        localStorage.setItem("onyx-theme-migrated", "1");
        applyTheme("midnight");
        return;
      }
      applyTheme(saved);
      return;
    }
  } catch {
    // ignore
  }
  if (configTheme) {
    applyTheme(configTheme);
  }
}
