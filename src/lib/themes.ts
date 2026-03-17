import { reapplyStyleOverrides } from "./configBridge";

export interface Theme {
  id: string;
  name: string;
}

const darkTheme: Theme = {
  id: "dark",
  name: "Dark",
};

const lightTheme: Theme = {
  id: "light",
  name: "Light",
};

const warm2Theme: Theme = {
  id: "warm2",
  name: "Warm 2",
};

const warmTheme: Theme = {
  id: "warm",
  name: "Warm",
};

const creamTheme: Theme = {
  id: "cream",
  name: "Cream",
};

const catppuccinTheme: Theme = {
  id: "catppuccin",
  name: "Catppuccin",
};

const nordTheme: Theme = {
  id: "nord",
  name: "Nord",
};

const rosePineTheme: Theme = {
  id: "rose-pine",
  name: "Rosé Pine",
};

const draculaTheme: Theme = {
  id: "dracula",
  name: "Dracula",
};

const gruvboxTheme: Theme = {
  id: "gruvbox",
  name: "Gruvbox",
};

const sakuraTheme: Theme = {
  id: "sakura",
  name: "Sakura",
};

const midnightTheme: Theme = {
  id: "midnight",
  name: "Midnight",
};

const campfireTheme: Theme = {
  id: "campfire",
  name: "Campfire",
};

const auroraTheme: Theme = {
  id: "aurora",
  name: "Aurora",
};

const sandstormTheme: Theme = {
  id: "sandstorm",
  name: "Sandstorm",
};

const noirTheme: Theme = {
  id: "noir",
  name: "Noir",
};

const velvetTheme: Theme = {
  id: "velvet",
  name: "Velvet",
};

const reefTheme: Theme = {
  id: "reef",
  name: "Reef",
};

const builtInThemes: Theme[] = [
  darkTheme, lightTheme, creamTheme, warmTheme, warm2Theme,
  catppuccinTheme, nordTheme, rosePineTheme, draculaTheme, gruvboxTheme,
  sakuraTheme, midnightTheme, campfireTheme, auroraTheme, sandstormTheme,
  noirTheme, velvetTheme, reefTheme,
];
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
      applyTheme(saved);
      return;
    }
  } catch {
    // ignore
  }
  // Fall back to config value if localStorage is empty
  if (configTheme) {
    applyTheme(configTheme);
  }
}
