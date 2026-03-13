import { invoke } from "@tauri-apps/api/core";

let autoSaveMs = 500;

export function getAutoSaveMs(): number {
  return autoSaveMs;
}

interface AppConfig {
  editor: {
    font_family: string;
    font_size: number;
    line_height: number;
    content_max_width: number | null;
    show_line_numbers: boolean;
    tab_size: number;
  };
  appearance: {
    theme: string;
    sidebar_width: number;
    context_panel_width: number;
    ui_font: string | null;
    mono_font: string | null;
  };
  behavior: {
    auto_save_ms: number;
    spellcheck: boolean;
  };
}

export function applyConfig(config: AppConfig) {
  const s = document.documentElement.style;

  // Editor
  s.setProperty("--font-editor", `"${config.editor.font_family}", Georgia, serif`);
  s.setProperty("--editor-font-size", `${config.editor.font_size}px`);
  s.setProperty("--editor-line-height", `${config.editor.line_height}`);
  s.setProperty("--editor-max-width", config.editor.content_max_width ? `${config.editor.content_max_width}px` : "none");

  // Appearance
  s.setProperty("--sidebar-width", `${config.appearance.sidebar_width}px`);
  s.setProperty("--context-panel-width", `${config.appearance.context_panel_width}px`);
  if (config.appearance.ui_font) {
    s.setProperty("--font-ui", `"${config.appearance.ui_font}", -apple-system, BlinkMacSystemFont, sans-serif`);
  }
  if (config.appearance.mono_font) {
    s.setProperty("--font-mono", `"${config.appearance.mono_font}", "SF Mono", monospace`);
  }

  // Behavior
  autoSaveMs = config.behavior.auto_save_ms;
  document.documentElement.setAttribute("spellcheck", config.behavior.spellcheck ? "true" : "false");
}

export async function loadAndApplyConfig() {
  try {
    const config = await invoke<AppConfig>("get_config");
    applyConfig(config);
  } catch (err) {
    console.error("Failed to load config:", err);
  }
}
