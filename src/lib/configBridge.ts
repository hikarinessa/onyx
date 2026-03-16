import { invoke } from "@tauri-apps/api/core";
import type { HeadingStyle } from "./configTypes";

// Injected by Editor.tsx to avoid circular imports
let remeasureHook: (() => void) | null = null;
export function setRemeasureHook(fn: () => void) {
  remeasureHook = fn;
}

let autoSaveMs = 500;
let lintingEnabled = true;
let autofixOnSave = false;
let spellcheckEnabled = false;
let defaultEditorMode: string = "preview";
let showLineNumbers = true;
let tabSize = 4;

// Per-rule flags (all default true)
let ruleTrailingSpaces = true;
let ruleHardTabs = true;
let ruleMultipleBlanks = true;
let ruleTrailingNewline = true;
let ruleAtxSpacing = true;
let ruleReversedLinks = true;
let ruleSpaceInEmphasis = true;
let ruleHeadingIncrement = true;
let ruleConsistentListMarker = true;
let ruleHrStyle = true;
let ruleEmptyLinks = true;

export function getAutoSaveMs(): number {
  return autoSaveMs;
}

export function isLintingEnabled(): boolean {
  return lintingEnabled;
}

export function isAutofixOnSave(): boolean {
  return autofixOnSave;
}

export function isSpellcheckEnabled(): boolean {
  return spellcheckEnabled;
}

export function getDefaultEditorMode(): string {
  return defaultEditorMode;
}

export function getShowLineNumbers(): boolean {
  return showLineNumbers;
}

export function getTabSize(): number {
  return tabSize;
}

export function getLintRules() {
  return {
    trailing_spaces: ruleTrailingSpaces,
    hard_tabs: ruleHardTabs,
    multiple_blanks: ruleMultipleBlanks,
    trailing_newline: ruleTrailingNewline,
    atx_spacing: ruleAtxSpacing,
    reversed_links: ruleReversedLinks,
    space_in_emphasis: ruleSpaceInEmphasis,
    heading_increment: ruleHeadingIncrement,
    consistent_list_marker: ruleConsistentListMarker,
    hr_style: ruleHrStyle,
    empty_links: ruleEmptyLinks,
  };
}

import type { AppConfig, ThemeColorOverrides } from "./configTypes";

let lastConfig: AppConfig | null = null;

const COLOR_OVERRIDE_MAP: Record<keyof ThemeColorOverrides, string> = {
  bg_base: "--bg-base",
  bg_surface: "--bg-surface",
  bg_elevated: "--bg-elevated",
  text_primary: "--text-primary",
  text_secondary: "--text-secondary",
  text_tertiary: "--text-tertiary",
  accent: "--accent",
  border_default: "--border-default",
  border_subtle: "--border-subtle",
};

function applyThemeOverrides(overrides: ThemeColorOverrides | undefined) {
  const s = document.documentElement.style;
  for (const [field, cssVar] of Object.entries(COLOR_OVERRIDE_MAP)) {
    const val = overrides?.[field as keyof ThemeColorOverrides] ?? "";
    if (val) {
      s.setProperty(cssVar, val);
    } else {
      s.removeProperty(cssVar);
    }
  }
}

function applyHeadingStyles(headings: Record<string, HeadingStyle>) {
  const s = document.documentElement.style;
  for (let i = 1; i <= 6; i++) {
    const key = `h${i}`;
    const h = headings[key];
    if (h && h.size > 0) {
      s.setProperty(`--heading-${i}-size`, `${h.size}em`);
    } else {
      s.removeProperty(`--heading-${i}-size`);
    }
    if (h && h.color) {
      s.setProperty(`--heading-${i}-color`, h.color);
    } else {
      s.removeProperty(`--heading-${i}-color`);
    }
  }
}

function applyElementStyles(config: AppConfig["style"]) {
  const s = document.documentElement.style;

  // Blockquotes
  if (config.blockquote_border_color) {
    s.setProperty("--blockquote-border-color", config.blockquote_border_color);
  } else {
    s.removeProperty("--blockquote-border-color");
  }
  s.setProperty("--blockquote-border-width", `${config.blockquote_border_width}px`);

  // Links
  if (config.link_color) {
    s.setProperty("--link-color", config.link_color);
  } else {
    s.removeProperty("--link-color");
  }
  s.setProperty("--link-underline", config.link_underline ? "underline" : "none");

  // Code blocks
  if (config.code_block_bg) {
    s.setProperty("--code-block-bg", config.code_block_bg);
  } else {
    s.removeProperty("--code-block-bg");
  }
  if (config.code_block_text) {
    s.setProperty("--code-block-text", config.code_block_text);
  } else {
    s.removeProperty("--code-block-text");
  }

  // Inline code
  if (config.inline_code_bg) {
    s.setProperty("--inline-code-bg", config.inline_code_bg);
  } else {
    s.removeProperty("--inline-code-bg");
  }
  if (config.inline_code_text) {
    s.setProperty("--inline-code-text", config.inline_code_text);
  } else {
    s.removeProperty("--inline-code-text");
  }

  // Tags
  if (config.tag_bg) {
    s.setProperty("--tag-bg", config.tag_bg);
  } else {
    s.removeProperty("--tag-bg");
  }
  if (config.tag_text) {
    s.setProperty("--tag-text", config.tag_text);
  } else {
    s.removeProperty("--tag-text");
  }

  // Spacing
  s.setProperty("--paragraph-spacing", `${config.paragraph_spacing}px`);
  s.setProperty("--list-indent", `${config.list_indent}px`);
}

const SYNTAX_MAP: Record<string, string> = {
  syntax_markup: "--syntax-markup",
  syntax_hr: "--syntax-hr",
  syntax_meta: "--syntax-meta",
  syntax_comment: "--syntax-comment",
  syntax_list_marker: "--syntax-list-marker",
  syntax_strikethrough: "--syntax-strikethrough",
  syntax_highlight_bg: "--syntax-highlight-bg",
};

function applySyntaxStyles(config: AppConfig["style"]) {
  const s = document.documentElement.style;
  for (const [field, cssVar] of Object.entries(SYNTAX_MAP)) {
    const val = (config as Record<string, unknown>)[field] as string;
    if (val) {
      s.setProperty(cssVar, val);
    } else {
      s.removeProperty(cssVar);
    }
  }
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

  // Editor settings
  defaultEditorMode = config.editor.default_mode || "preview";
  showLineNumbers = config.editor.show_line_numbers ?? true;
  tabSize = config.editor.tab_size ?? 4;

  // Behavior
  autoSaveMs = config.behavior.auto_save_ms;
  spellcheckEnabled = config.behavior.spellcheck;
  document.documentElement.setAttribute("spellcheck", config.behavior.spellcheck ? "true" : "false");

  // Style
  if (config.style) {
    if (config.style.accent_color) {
      s.setProperty("--accent", config.style.accent_color);
    }
    s.setProperty("--editor-padding-x", `${config.style.editor_padding_x}px`);
    s.setProperty("--editor-padding-y", `${config.style.editor_padding_y}px`);
    s.setProperty("--inline-title-size", `${config.style.inline_title_size}em`);
    s.setProperty("--ui-font-size", `${config.style.ui_font_size}px`);

    // Custom CSS — inject/update a <style> element
    let customStyle = document.getElementById("onyx-custom-css") as HTMLStyleElement | null;
    if (config.style.custom_css) {
      if (!customStyle) {
        customStyle = document.createElement("style");
        customStyle.id = "onyx-custom-css";
        document.head.appendChild(customStyle);
      }
      customStyle.textContent = config.style.custom_css;
    } else if (customStyle) {
      customStyle.remove();
    }

    // Theme color overrides — apply for the currently active theme
    const activeTheme = document.documentElement.getAttribute("data-theme") || "dark";
    applyThemeOverrides(config.style.theme_overrides[activeTheme]);

    // Headings
    applyHeadingStyles(config.style.headings);

    // Element styles + spacing
    applyElementStyles(config.style);

    // Syntax highlighting
    applySyntaxStyles(config.style);
  }

  // Linting
  if (config.linting) {
    lintingEnabled = config.linting.enabled;
    autofixOnSave = config.linting.autofix_on_save;
    ruleTrailingSpaces = config.linting.trailing_spaces ?? true;
    ruleHardTabs = config.linting.hard_tabs ?? true;
    ruleMultipleBlanks = config.linting.multiple_blanks ?? true;
    ruleTrailingNewline = config.linting.trailing_newline ?? true;
    ruleAtxSpacing = config.linting.atx_spacing ?? true;
    ruleReversedLinks = config.linting.reversed_links ?? true;
    ruleSpaceInEmphasis = config.linting.space_in_emphasis ?? true;
    ruleHeadingIncrement = config.linting.heading_increment ?? true;
    ruleConsistentListMarker = config.linting.consistent_list_marker ?? true;
    ruleHrStyle = config.linting.hr_style ?? true;
    ruleEmptyLinks = config.linting.empty_links ?? true;
  }

  lastConfig = config;

  // Tell CM6 to re-measure after font/sizing changes
  if (remeasureHook) remeasureHook();
}

/** Called by themes.ts after switching themes to re-apply per-theme color overrides. */
export function reapplyStyleOverrides() {
  if (!lastConfig) return;
  const activeTheme = document.documentElement.getAttribute("data-theme") || "dark";
  applyThemeOverrides(lastConfig.style.theme_overrides[activeTheme]);
}

export async function loadAndApplyConfig() {
  try {
    const config = await invoke<AppConfig>("get_config");
    applyConfig(config);
    // Restore theme from config as fallback if localStorage is empty
    const { restoreTheme } = await import("./themes");
    restoreTheme(config.appearance.theme);
  } catch (err) {
    console.error("Failed to load config:", err);
  }
}
