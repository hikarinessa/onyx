import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ThemePreview } from "./ThemePreview";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { getAvailableThemes, applyTheme, getActiveThemeId } from "../lib/themes";
import { applyConfig } from "../lib/configBridge";
import { getAllCommands } from "../lib/commands";
import {
  getAllBindings,
  setUserOverride,
  resetBinding,
  resetAll,
  getConflicts,
  parseKeyCombo,
  type KeyBinding,
} from "../lib/keybindings";
import type { AppConfig, ThemeColorOverrides, HeadingStyle } from "../lib/configTypes";
import { Icon } from "./Icon";
import { open } from "@tauri-apps/plugin-dialog";

type Section = "general" | "editor" | "appearance" | "templates" | "objects" | "keybindings" | "about";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "editor", label: "Editor", icon: "type" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "templates", label: "Templates", icon: "file-text" },
  { id: "objects", label: "Objects", icon: "box" },
  { id: "keybindings", label: "Keybindings", icon: "keyboard" },
  { id: "about", label: "About", icon: "info" },
];

// ── Helpers ──

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

// ── Debounced config save ──

let configSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPartial: Record<string, unknown> = {};

function deepMergePartials(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, val] of Object.entries(patch)) {
    if (
      typeof val === "object" &&
      val !== null &&
      !Array.isArray(val) &&
      typeof result[key] === "object" &&
      result[key] !== null
    ) {
      result[key] = deepMergePartials(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ── Main component ──

export function Settings() {
  const visible = useAppStore((s) => s.settingsVisible);
  const setVisible = useAppStore((s) => s.setSettingsVisible);

  const [section, setSection] = useState<Section>("general");
  const [config, setConfig] = useState<AppConfig | null>(null);

  // Load config on open
  useEffect(() => {
    if (!visible) return;
    setSection("general");
    invoke<AppConfig>("get_config").then(setConfig).catch(console.error);
  }, [visible]);

  // Escape to close
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setVisible(false);
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [visible, setVisible]);

  const updateConfig = useCallback(
    (partial: Record<string, unknown>) => {
      // Accumulate partials and debounce the disk write
      pendingPartial = deepMergePartials(pendingPartial, partial);
      if (configSaveTimer) clearTimeout(configSaveTimer);
      configSaveTimer = setTimeout(() => {
        invoke("update_config", { json: JSON.stringify(pendingPartial) }).catch(console.error);
        pendingPartial = {};
      }, 300);
      // Optimistic local update + apply to live UI (deep merge to match Rust side)
      setConfig((prev) => {
        if (!prev) return prev;
        const next = deepMergePartials(
          JSON.parse(JSON.stringify(prev)),
          partial,
        ) as unknown as AppConfig;
        applyConfig(next);
        return next;
      });
    },
    []
  );

  if (!visible || !config) return null;

  return (
    <div className="settings-overlay" onClick={() => setVisible(false)}>
      <div
        className="settings-modal"
        data-has-preview={section === "appearance" ? "" : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-sidebar">
          <div className="settings-sidebar-title">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item ${section === s.id ? "active" : ""}`}
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={14} />
              {s.label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          {section === "general" && (
            <GeneralSection config={config} updateConfig={updateConfig} />
          )}
          {section === "editor" && (
            <EditorSection config={config} updateConfig={updateConfig} />
          )}
          {section === "appearance" && (
            <AppearanceSection config={config} updateConfig={updateConfig} />
          )}
          {section === "templates" && (
            <TemplatesSection config={config} updateConfig={updateConfig} />
          )}
          {section === "objects" && <ObjectsSection />}
          {section === "keybindings" && <KeybindingsSection />}
          {section === "about" && <AboutSection />}
        </div>
        {section === "appearance" && (
          <div className="settings-preview-pane">
            <ThemePreview configVersion={JSON.stringify(config).length} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable controls ──

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span className="settings-row-title">{label}</span>
        {description && (
          <span className="settings-row-desc">{description}</span>
        )}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`settings-toggle ${checked ? "on" : ""} ${disabled ? "disabled" : ""}`}
      onClick={() => { if (!disabled) onChange(!checked); }}
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

function ColorPicker({
  value,
  fallback,
  onChange,
  onReset,
}: {
  value: string;
  fallback: string;
  onChange: (v: string) => void;
  onReset?: () => void;
}) {
  return (
    <>
      <input
        type="color"
        className="settings-color-input"
        value={value || fallback}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && onReset && (
        <button className="settings-keybind-reset" onClick={onReset}>
          Reset
        </button>
      )}
    </>
  );
}

function SubSection({ title }: { title: string }) {
  return <h3 className="settings-subsection-title">{title}</h3>;
}

// ── Section: General ──

function GeneralSection({
  config,
  updateConfig,
}: {
  config: AppConfig;
  updateConfig: (partial: Record<string, unknown>) => void;
}) {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">General</h2>

      <SettingRow
        label="Auto-save interval"
        description={`Save after ${formatMs(config.behavior.auto_save_ms)} of inactivity`}
      >
        <input
          type="range"
          className="settings-range"
          min={250}
          max={5000}
          step={250}
          value={config.behavior.auto_save_ms}
          onChange={(e) =>
            updateConfig({ behavior: { auto_save_ms: Number(e.target.value) } })
          }
        />
        <span className="settings-range-value">
          {formatMs(config.behavior.auto_save_ms)}
        </span>
      </SettingRow>

      <SettingRow label="Spellcheck" description="OS-native spellcheck via WebKit">
        <Toggle
          checked={config.behavior.spellcheck}
          onChange={(v) => updateConfig({ behavior: { spellcheck: v } })}
        />
      </SettingRow>

      <SettingRow label="Hide empty folders" description="Hide folders that contain no markdown files">
        <Toggle
          checked={config.behavior.hide_empty_folders}
          onChange={(v) => updateConfig({ behavior: { hide_empty_folders: v } })}
        />
      </SettingRow>

    </div>
  );
}

// ── Section: Editor ──

function EditorSection({
  config,
  updateConfig,
}: {
  config: AppConfig;
  updateConfig: (partial: Record<string, unknown>) => void;
}) {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Editor</h2>

      <SettingRow label="Default mode">
        <select
          className="settings-select"
          value={config.editor.default_mode}
          onChange={(e) =>
            updateConfig({ editor: { default_mode: e.target.value } })
          }
        >
          <option value="preview">Preview</option>
          <option value="source">Source</option>
        </select>
      </SettingRow>

      <SettingRow label="Show line numbers in source mode" description="Takes effect on restart">
        <Toggle
          checked={config.editor.show_line_numbers}
          onChange={(v) =>
            updateConfig({ editor: { show_line_numbers: v } })
          }
        />
      </SettingRow>

      <SettingRow label="Tab size" description="Takes effect on restart">
        <select
          className="settings-select"
          value={config.editor.tab_size}
          onChange={(e) =>
            updateConfig({ editor: { tab_size: Number(e.target.value) } })
          }
        >
          <option value={2}>2</option>
          <option value={4}>4</option>
          <option value={8}>8</option>
        </select>
      </SettingRow>

      <SubSection title="Linting" />

      <SettingRow label="Enable linting" description="Show warnings and errors in the status bar">
        <Toggle
          checked={config.linting.enabled}
          onChange={(v) => updateConfig({ linting: { enabled: v } })}
        />
      </SettingRow>

      <SettingRow label="Autofix on save" description="Automatically fix auto-fixable issues on save">
        <Toggle
          checked={config.linting.autofix_on_save}
          onChange={(v) => updateConfig({ linting: { autofix_on_save: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SubSection title="Autofix Rules" />

      <SettingRow label="Trailing whitespace" description="Remove trailing spaces and tabs">
        <Toggle
          checked={config.linting.trailing_spaces}
          onChange={(v) => updateConfig({ linting: { trailing_spaces: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SettingRow label="Hard tabs" description="Replace tabs with spaces">
        <Toggle
          checked={config.linting.hard_tabs}
          onChange={(v) => updateConfig({ linting: { hard_tabs: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SettingRow label="Multiple blank lines" description="Collapse 3+ blank lines to 2">
        <Toggle
          checked={config.linting.multiple_blanks}
          onChange={(v) => updateConfig({ linting: { multiple_blanks: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SettingRow label="Trailing newline" description="Ensure single trailing newline">
        <Toggle
          checked={config.linting.trailing_newline}
          onChange={(v) => updateConfig({ linting: { trailing_newline: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SettingRow label="ATX heading spacing" description="Require space after # in headings">
        <Toggle
          checked={config.linting.atx_spacing}
          onChange={(v) => updateConfig({ linting: { atx_spacing: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SettingRow label="Reversed links" description="Detect (text)[url] instead of [text](url)">
        <Toggle
          checked={config.linting.reversed_links}
          onChange={(v) => updateConfig({ linting: { reversed_links: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SettingRow label="Space in emphasis" description="Detect * text * instead of *text*">
        <Toggle
          checked={config.linting.space_in_emphasis}
          onChange={(v) => updateConfig({ linting: { space_in_emphasis: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SubSection title="Warning Rules" />

      <SettingRow label="Heading increment" description="Warn when heading levels are skipped">
        <Toggle
          checked={config.linting.heading_increment}
          onChange={(v) => updateConfig({ linting: { heading_increment: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SettingRow label="Consistent list markers" description="Warn on mixed list markers (-, *, +)">
        <Toggle
          checked={config.linting.consistent_list_marker}
          onChange={(v) => updateConfig({ linting: { consistent_list_marker: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SettingRow label="Horizontal rule style" description="Warn on non-standard HR (prefer ***)">
        <Toggle
          checked={config.linting.hr_style}
          onChange={(v) => updateConfig({ linting: { hr_style: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>

      <SettingRow label="Empty links" description="Warn on links with empty text or URL">
        <Toggle
          checked={config.linting.empty_links}
          onChange={(v) => updateConfig({ linting: { empty_links: v } })}
          disabled={!config.linting.enabled}
        />
      </SettingRow>
    </div>
  );
}

// ── Section: Appearance ──

const THEME_SWATCHES: Record<string, { bg: string; surface: string; accent: string; text: string }> = {
  dark: { bg: "#0e0e12", surface: "#1a1a20", accent: "#8b7cf6", text: "#e8e8ec" },
  light: { bg: "#ffffff", surface: "#eeeef0", accent: "#6b5ce7", text: "#1d1d1f" },
  warm2: { bg: "#232323", surface: "#2d2d2d", accent: "#00a3d7", text: "#ebebeb" },
  warm: { bg: "#1c1917", surface: "#292523", accent: "#d4a574", text: "#ede8e3" },
  cream: { bg: "#e8ded6", surface: "#006a81", accent: "#2e7d7d", text: "#2c3030" },
  catppuccin: { bg: "#1e1e2e", surface: "#313244", accent: "#89b4fa", text: "#cdd6f4" },
  nord: { bg: "#2e3440", surface: "#3b4252", accent: "#88c0d0", text: "#eceff4" },
  "rose-pine": { bg: "#191724", surface: "#26233a", accent: "#ebbcba", text: "#e0def4" },
  dracula: { bg: "#282a36", surface: "#44475a", accent: "#bd93f9", text: "#f8f8f2" },
  gruvbox: { bg: "#282828", surface: "#3c3836", accent: "#83a598", text: "#ebdbb2" },
  sakura: { bg: "#fdf6f4", surface: "#f5ebe8", accent: "#c45b84", text: "#3d2b2b" },
  midnight: { bg: "#0a0e1a", surface: "#182030", accent: "#00d4aa", text: "#c8d8f0" },
  campfire: { bg: "#1a1210", surface: "#2e201a", accent: "#e88a40", text: "#e8d4c4" },
  aurora: { bg: "#0e1018", surface: "#1c202e", accent: "#50e8b0", text: "#d0d8e8" },
  sandstorm: { bg: "#f4ece2", surface: "#ddd0c2", accent: "#c06030", text: "#3a3028" },
  noir: { bg: "#141414", surface: "#222222", accent: "#d4a040", text: "#d8d8d8" },
  velvet: { bg: "#1a1018", surface: "#2c202a", accent: "#d4a050", text: "#e0d4dc" },
  reef: { bg: "#f0f6f6", surface: "#d8e6e6", accent: "#e05848", text: "#1a3030" },
};

function AppearanceSection({
  config,
  updateConfig,
}: {
  config: AppConfig;
  updateConfig: (partial: Record<string, unknown>) => void;
}) {
  const themes = getAvailableThemes();
  const activeTheme = getActiveThemeId();
  const [colorTheme, setColorTheme] = useState(activeTheme);

  const handleThemeChange = (themeId: string) => {
    applyTheme(themeId);
    updateConfig({ appearance: { theme: themeId } });
    setColorTheme(themeId);
  };

  // Get color overrides for the selected theme tab
  const overrides: ThemeColorOverrides = config.style.theme_overrides[colorTheme] ?? {
    bg_base: "", bg_surface: "", bg_elevated: "",
    text_primary: "", text_secondary: "", text_tertiary: "",
    accent: "", border_default: "", border_subtle: "",
  };

  const updateColorOverride = (field: keyof ThemeColorOverrides, value: string) => {
    const current = config.style.theme_overrides[colorTheme] ?? {};
    updateConfig({
      style: {
        theme_overrides: {
          ...config.style.theme_overrides,
          [colorTheme]: { ...current, [field]: value },
        },
      },
    });
  };

  const HEADING_DEFAULTS: Record<string, number> = {
    h1: 1.6, h2: 1.3, h3: 1.1, h4: 1.05, h5: 1.0, h6: 0.9,
  };

  const getHeading = (key: string): HeadingStyle =>
    config.style.headings[key] ?? { size: HEADING_DEFAULTS[key] ?? 1.0, color: "" };

  const updateHeading = (key: string, patch: Partial<HeadingStyle>) => {
    const current = getHeading(key);
    updateConfig({
      style: {
        headings: {
          ...config.style.headings,
          [key]: { ...current, ...patch },
        },
      },
    });
  };

  // Color label->field mapping for the palette editor
  const COLOR_FIELDS: { field: keyof ThemeColorOverrides; label: string; fallback: string }[] = [
    { field: "bg_base", label: "Background", fallback: "#0e0e12" },
    { field: "bg_surface", label: "Surface", fallback: "#141418" },
    { field: "bg_elevated", label: "Elevated", fallback: "#1a1a20" },
    { field: "text_primary", label: "Text", fallback: "#e8e8ec" },
    { field: "text_secondary", label: "Text secondary", fallback: "#9898a4" },
    { field: "text_tertiary", label: "Text muted", fallback: "#5c5c68" },
    { field: "accent", label: "Accent", fallback: "#8b7cf6" },
    { field: "border_default", label: "Border", fallback: "#2a2a34" },
    { field: "border_subtle", label: "Border subtle", fallback: "#1e1e26" },
  ];

  // Adjust fallback colors based on selected colorTheme
  const THEME_FALLBACKS: Record<string, Record<string, string>> = {
    dark: { bg_base: "#0e0e12", bg_surface: "#141418", bg_elevated: "#1a1a20", text_primary: "#e8e8ec", text_secondary: "#9898a4", text_tertiary: "#5c5c68", accent: "#8b7cf6", border_default: "#2a2a34", border_subtle: "#1e1e26" },
    light: { bg_base: "#ffffff", bg_surface: "#f5f5f7", bg_elevated: "#eeeef0", text_primary: "#1d1d1f", text_secondary: "#6e6e73", text_tertiary: "#9a9aa0", accent: "#6b5ce7", border_default: "#d2d2d7", border_subtle: "#e5e5ea" },
    warm2: { bg_base: "#232323", bg_surface: "#252525", bg_elevated: "#2d2d2d", text_primary: "#ebebeb", text_secondary: "#c0c0c0", text_tertiary: "#6b7280", accent: "#00a3d7", border_default: "#404040", border_subtle: "#404040" },
    warm: { bg_base: "#1c1917", bg_surface: "#221f1c", bg_elevated: "#292523", text_primary: "#ede8e3", text_secondary: "#a8a09a", text_tertiary: "#6b635d", accent: "#d4a574", border_default: "#38322e", border_subtle: "#2a2522" },
  };

  return (
    <div className="settings-section">
      {/* -- Theme -- */}
      <h2 className="settings-section-title">Appearance</h2>

      <div className="settings-row-full">
        <span className="settings-row-title">Theme</span>
        <div className="settings-theme-cards">
          {themes.map((t) => {
            const sw = THEME_SWATCHES[t.id] ?? THEME_SWATCHES.dark;
            return (
              <button
                key={t.id}
                className={`settings-theme-card ${activeTheme === t.id ? "active" : ""}`}
                onClick={() => handleThemeChange(t.id)}
              >
                <div className="settings-theme-preview" style={{ background: sw.bg }}>
                  <div className="settings-theme-swatch-bar" style={{ background: sw.surface }} />
                  <div className="settings-theme-swatch-accent" style={{ background: sw.accent }} />
                  <div className="settings-theme-swatch-text" style={{ background: sw.text }} />
                </div>
                <span className="settings-theme-label">{t.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <SettingRow label="Sidebar width" description={`${config.appearance.sidebar_width}px`}>
        <input type="range" className="settings-range" min={180} max={400} step={10}
          value={config.appearance.sidebar_width}
          onChange={(e) => updateConfig({ appearance: { sidebar_width: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.appearance.sidebar_width}px</span>
      </SettingRow>

      <SettingRow label="Context panel width" description={`${config.appearance.context_panel_width}px`}>
        <input type="range" className="settings-range" min={220} max={400} step={10}
          value={config.appearance.context_panel_width}
          onChange={(e) => updateConfig({ appearance: { context_panel_width: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.appearance.context_panel_width}px</span>
      </SettingRow>

      {/* -- Typography -- */}
      <SubSection title="Typography" />

      <SettingRow label="Editor font">
        <input
          type="text"
          className="settings-text-input"
          value={config.editor.font_family}
          placeholder="Literata"
          onChange={(e) => updateConfig({ editor: { font_family: e.target.value } })}
        />
      </SettingRow>

      <SettingRow label="Editor font size" description={`${config.editor.font_size}px`}>
        <input type="range" className="settings-range" min={12} max={24} step={1}
          value={config.editor.font_size}
          onChange={(e) => updateConfig({ editor: { font_size: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.editor.font_size}px</span>
      </SettingRow>

      <SettingRow label="Line height" description={`${config.editor.line_height.toFixed(1)}`}>
        <input type="range" className="settings-range" min={1.2} max={2.4} step={0.1}
          value={config.editor.line_height}
          onChange={(e) => updateConfig({ editor: { line_height: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.editor.line_height.toFixed(1)}</span>
      </SettingRow>

      <SettingRow
        label="Content max width"
        description={config.editor.content_max_width === null ? "Unlimited" : `${config.editor.content_max_width}px`}
      >
        <label className="settings-inline-toggle">
          <Toggle
            checked={config.editor.content_max_width === null}
            onChange={(v) => updateConfig({ editor: { content_max_width: v ? null : 720 } })}
          />
          <span className="settings-inline-label">Unlimited</span>
        </label>
        {config.editor.content_max_width !== null && (
          <>
            <input type="range" className="settings-range" min={500} max={1200} step={10}
              value={config.editor.content_max_width ?? 720}
              onChange={(e) => updateConfig({ editor: { content_max_width: Number(e.target.value) } })}
            />
            <span className="settings-range-value">{config.editor.content_max_width}px</span>
          </>
        )}
      </SettingRow>

      <SettingRow label="UI font override">
        <input type="text" className="settings-text-input" value={config.appearance.ui_font ?? ""} placeholder="DM Sans"
          onChange={(e) => updateConfig({ appearance: { ui_font: e.target.value || null } })}
        />
      </SettingRow>

      <SettingRow label="Mono font override">
        <input type="text" className="settings-text-input" value={config.appearance.mono_font ?? ""} placeholder="IBM Plex Mono"
          onChange={(e) => updateConfig({ appearance: { mono_font: e.target.value || null } })}
        />
      </SettingRow>

      {/* -- Colors -- */}
      <SubSection title="Colors" />

      <div className="settings-color-theme-tabs">
        {["dark", "light", "warm", "warm2"].map((t) => (
          <button
            key={t}
            className={`settings-color-tab ${colorTheme === t ? "active" : ""}`}
            onClick={() => setColorTheme(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="settings-color-grid">
        {COLOR_FIELDS.map(({ field, label }) => {
          const fb = THEME_FALLBACKS[colorTheme]?.[field] ?? "#888888";
          return (
            <div key={field} className="settings-color-item">
              <input
                type="color"
                className="settings-color-input"
                value={overrides[field] || fb}
                onChange={(e) => updateColorOverride(field, e.target.value)}
              />
              <span className="settings-color-label">{label}</span>
              {overrides[field] && (
                <button
                  className="settings-color-reset"
                  onClick={() => updateColorOverride(field, "")}
                  title="Reset to theme default"
                >
                  x
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* -- Headings -- */}
      <SubSection title="Headings" />

      {["h1", "h2", "h3", "h4", "h5", "h6"].map((key) => {
        const h = getHeading(key);
        const def = HEADING_DEFAULTS[key];
        return (
          <div key={key} className="settings-heading-row">
            <span className="settings-heading-label">{key.toUpperCase()}</span>
            <input
              type="range"
              className="settings-range"
              min={0.7}
              max={3.0}
              step={0.05}
              value={h.size}
              onChange={(e) => updateHeading(key, { size: Number(e.target.value) })}
            />
            <span className="settings-range-value">{h.size.toFixed(2)}em</span>
            <input
              type="color"
              className="settings-color-input"
              value={h.color || (THEME_FALLBACKS[activeTheme]?.text_primary ?? "#e8e8ec")}
              onChange={(e) => updateHeading(key, { color: e.target.value })}
            />
            {(h.size !== def || h.color) && (
              <button
                className="settings-color-reset"
                onClick={() => updateHeading(key, { size: def, color: "" })}
                title="Reset"
              >
                x
              </button>
            )}
          </div>
        );
      })}

      {/* -- Elements -- */}
      <SubSection title="Elements" />

      <SettingRow label="Blockquote border color">
        <ColorPicker
          value={config.style.blockquote_border_color}
          fallback={THEME_FALLBACKS[activeTheme]?.accent ?? "#8b7cf6"}
          onChange={(v) => updateConfig({ style: { blockquote_border_color: v } })}
          onReset={() => updateConfig({ style: { blockquote_border_color: "" } })}
        />
      </SettingRow>

      <SettingRow label="Blockquote border width" description={`${config.style.blockquote_border_width}px`}>
        <input type="range" className="settings-range" min={1} max={8} step={1}
          value={config.style.blockquote_border_width}
          onChange={(e) => updateConfig({ style: { blockquote_border_width: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.style.blockquote_border_width}px</span>
      </SettingRow>

      <SettingRow label="Link color">
        <ColorPicker
          value={config.style.link_color}
          fallback="#7ca8f6"
          onChange={(v) => updateConfig({ style: { link_color: v } })}
          onReset={() => updateConfig({ style: { link_color: "" } })}
        />
      </SettingRow>

      <SettingRow label="Link underline">
        <Toggle
          checked={config.style.link_underline}
          onChange={(v) => updateConfig({ style: { link_underline: v } })}
        />
      </SettingRow>

      <SettingRow label="Code block background">
        <ColorPicker
          value={config.style.code_block_bg}
          fallback={THEME_FALLBACKS[activeTheme]?.bg_elevated ?? "#1a1a20"}
          onChange={(v) => updateConfig({ style: { code_block_bg: v } })}
          onReset={() => updateConfig({ style: { code_block_bg: "" } })}
        />
      </SettingRow>

      <SettingRow label="Code block text">
        <ColorPicker
          value={config.style.code_block_text}
          fallback={THEME_FALLBACKS[activeTheme]?.text_primary ?? "#e8e8ec"}
          onChange={(v) => updateConfig({ style: { code_block_text: v } })}
          onReset={() => updateConfig({ style: { code_block_text: "" } })}
        />
      </SettingRow>

      <SettingRow label="Inline code background">
        <ColorPicker
          value={config.style.inline_code_bg}
          fallback="rgba(139,124,246,0.1)"
          onChange={(v) => updateConfig({ style: { inline_code_bg: v } })}
          onReset={() => updateConfig({ style: { inline_code_bg: "" } })}
        />
      </SettingRow>

      <SettingRow label="Inline code text">
        <ColorPicker
          value={config.style.inline_code_text}
          fallback={THEME_FALLBACKS[activeTheme]?.text_primary ?? "#e8e8ec"}
          onChange={(v) => updateConfig({ style: { inline_code_text: v } })}
          onReset={() => updateConfig({ style: { inline_code_text: "" } })}
        />
      </SettingRow>

      <SettingRow label="Tag background">
        <ColorPicker
          value={config.style.tag_bg}
          fallback="rgba(139,124,246,0.12)"
          onChange={(v) => updateConfig({ style: { tag_bg: v } })}
          onReset={() => updateConfig({ style: { tag_bg: "" } })}
        />
      </SettingRow>

      <SettingRow label="Tag text">
        <ColorPicker
          value={config.style.tag_text}
          fallback="#a89cf8"
          onChange={(v) => updateConfig({ style: { tag_text: v } })}
          onReset={() => updateConfig({ style: { tag_text: "" } })}
        />
      </SettingRow>

      {/* -- Syntax Colors -- */}
      <SubSection title="Syntax Colors" />

      <SettingRow label="Markdown syntax chars" description="##, **, ```, etc.">
        <ColorPicker
          value={config.style.syntax_markup}
          fallback={THEME_FALLBACKS[activeTheme]?.text_tertiary ?? "#5c5c68"}
          onChange={(v) => updateConfig({ style: { syntax_markup: v } })}
          onReset={() => updateConfig({ style: { syntax_markup: "" } })}
        />
      </SettingRow>

      <SettingRow label="Horizontal rules">
        <ColorPicker
          value={config.style.syntax_hr}
          fallback={THEME_FALLBACKS[activeTheme]?.text_tertiary ?? "#5c5c68"}
          onChange={(v) => updateConfig({ style: { syntax_hr: v } })}
          onReset={() => updateConfig({ style: { syntax_hr: "" } })}
        />
      </SettingRow>

      <SettingRow label="Frontmatter delimiters">
        <ColorPicker
          value={config.style.syntax_meta}
          fallback={THEME_FALLBACKS[activeTheme]?.text_tertiary ?? "#5c5c68"}
          onChange={(v) => updateConfig({ style: { syntax_meta: v } })}
          onReset={() => updateConfig({ style: { syntax_meta: "" } })}
        />
      </SettingRow>

      <SettingRow label="Comments">
        <ColorPicker
          value={config.style.syntax_comment}
          fallback={THEME_FALLBACKS[activeTheme]?.text_tertiary ?? "#5c5c68"}
          onChange={(v) => updateConfig({ style: { syntax_comment: v } })}
          onReset={() => updateConfig({ style: { syntax_comment: "" } })}
        />
      </SettingRow>

      <SettingRow label="List markers">
        <ColorPicker
          value={config.style.syntax_list_marker}
          fallback={THEME_FALLBACKS[activeTheme]?.accent ?? "#8b7cf6"}
          onChange={(v) => updateConfig({ style: { syntax_list_marker: v } })}
          onReset={() => updateConfig({ style: { syntax_list_marker: "" } })}
        />
      </SettingRow>

      <SettingRow label="Strikethrough">
        <ColorPicker
          value={config.style.syntax_strikethrough}
          fallback={THEME_FALLBACKS[activeTheme]?.text_secondary ?? "#9898a4"}
          onChange={(v) => updateConfig({ style: { syntax_strikethrough: v } })}
          onReset={() => updateConfig({ style: { syntax_strikethrough: "" } })}
        />
      </SettingRow>

      <SettingRow label="Highlight background" description="==text==">
        <ColorPicker
          value={config.style.syntax_highlight_bg}
          fallback="rgba(255,204,0,0.3)"
          onChange={(v) => updateConfig({ style: { syntax_highlight_bg: v } })}
          onReset={() => updateConfig({ style: { syntax_highlight_bg: "" } })}
        />
      </SettingRow>

      {/* -- Spacing -- */}
      <SubSection title="Spacing" />

      <SettingRow label="Editor horizontal padding" description={`${config.style.editor_padding_x}px`}>
        <input type="range" className="settings-range" min={16} max={96} step={4}
          value={config.style.editor_padding_x}
          onChange={(e) => updateConfig({ style: { editor_padding_x: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.style.editor_padding_x}px</span>
      </SettingRow>

      <SettingRow label="Editor vertical padding" description={`${config.style.editor_padding_y}px`}>
        <input type="range" className="settings-range" min={8} max={64} step={4}
          value={config.style.editor_padding_y}
          onChange={(e) => updateConfig({ style: { editor_padding_y: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.style.editor_padding_y}px</span>
      </SettingRow>

      <SettingRow label="Inline title size" description={`${config.style.inline_title_size.toFixed(1)}em`}>
        <input type="range" className="settings-range" min={1.2} max={3.0} step={0.1}
          value={config.style.inline_title_size}
          onChange={(e) => updateConfig({ style: { inline_title_size: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.style.inline_title_size.toFixed(1)}em</span>
      </SettingRow>

      <SettingRow label="UI font size" description={`${config.style.ui_font_size}px`}>
        <input type="range" className="settings-range" min={11} max={16} step={1}
          value={config.style.ui_font_size}
          onChange={(e) => updateConfig({ style: { ui_font_size: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.style.ui_font_size}px</span>
      </SettingRow>

      <SettingRow label="Paragraph spacing" description={`${config.style.paragraph_spacing}px`}>
        <input type="range" className="settings-range" min={0} max={24} step={2}
          value={config.style.paragraph_spacing}
          onChange={(e) => updateConfig({ style: { paragraph_spacing: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.style.paragraph_spacing}px</span>
      </SettingRow>

      <SettingRow label="List indent" description={`${config.style.list_indent}px`}>
        <input type="range" className="settings-range" min={12} max={48} step={4}
          value={config.style.list_indent}
          onChange={(e) => updateConfig({ style: { list_indent: Number(e.target.value) } })}
        />
        <span className="settings-range-value">{config.style.list_indent}px</span>
      </SettingRow>

      {/* -- Custom CSS -- */}
      <SubSection title="Custom CSS" />

      <div className="settings-row-full">
        <div className="settings-row-label">
          <span className="settings-row-desc">
            Advanced: inject custom styles. Applied on top of everything.
          </span>
        </div>
        <textarea
          className="settings-custom-css"
          value={config.style.custom_css}
          onChange={(e) => updateConfig({ style: { custom_css: e.target.value } })}
          placeholder={`.cm-content {\n  /* your custom styles */\n}`}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ── Section: Objects ──

interface ObjectType {
  name: string;
  properties: PropertyDef[];
}

interface PropertyDef {
  key: string;
  type: string;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
}

const PROPERTY_TYPES = [
  { value: "text", label: "Text", icon: "type" },
  { value: "number", label: "Number", icon: "hash" },
  { value: "date", label: "Date", icon: "calendar" },
  { value: "checkbox", label: "Checkbox", icon: "check-square" },
  { value: "select", label: "Select", icon: "list" },
  { value: "multiselect", label: "Multi-select", icon: "list-checks" },
  { value: "tags", label: "Tags", icon: "tag" },
  { value: "link", label: "Link", icon: "link" },
];

function PropTypeButton({ type, onChange }: { type: string; onChange: (t: string) => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const current = PROPERTY_TYPES.find((pt) => pt.value === type) || PROPERTY_TYPES[0];

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <>
      <span
        className="settings-objects-prop-type-btn"
        title={`Type: ${current.label} (right-click to change)`}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
        onClick={(e) => { setMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <Icon name={current.icon} size={12} />
        {current.label}
      </span>
      {menu && (
        <div ref={ref} className="context-menu" style={{ left: menu.x, top: menu.y, position: "fixed", zIndex: 1100 }}>
          {PROPERTY_TYPES.map((pt) => (
            <div
              key={pt.value}
              className={`context-menu-item ${pt.value === type ? "active" : ""}`}
              onClick={() => { onChange(pt.value); setMenu(null); }}
            >
              <Icon name={pt.icon} size={12} />
              <span style={{ marginLeft: 6 }}>{pt.label}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Section: Templates ──

function TemplatesSection({
  config,
  updateConfig,
}: {
  config: AppConfig;
  updateConfig: (partial: Record<string, unknown>) => void;
}) {
  const dirs = config.behavior.template_dirs ?? [];

  const addDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const dirPath = typeof selected === "string" ? selected : selected[0];
    if (!dirPath || dirs.includes(dirPath)) return;
    updateConfig({ behavior: { template_dirs: [...dirs, dirPath] } });
  };

  const removeDir = (idx: number) => {
    const next = dirs.filter((_, i) => i !== idx);
    updateConfig({ behavior: { template_dirs: next } });
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Templates</h2>
      <p className="settings-section-description">
        Register directories containing .md files to use as templates via the /template slash command.
      </p>
      <div className="template-dirs-list">
        {dirs.length === 0 && (
          <div className="template-dirs-empty">No template directories registered</div>
        )}
        {dirs.map((dir, i) => (
          <div key={dir} className="template-dir-item">
            <span className="template-dir-path">{dir}</span>
            <button
              className="template-dir-remove"
              title="Remove"
              onClick={() => removeDir(i)}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      <button className="settings-btn" onClick={addDir}>
        <Icon name="folder-plus" size={14} />
        Add directory
      </button>
    </div>
  );
}

function ObjectsSection() {
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dirty, setDirty] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load types on mount
  useEffect(() => {
    invoke<ObjectType[]>("get_object_types").then(setTypes).catch(console.error);
  }, []);

  const saveTypes = useCallback((updated: ObjectType[]) => {
    setTypes(updated);
    setDirty(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      invoke("save_object_types", { json: JSON.stringify(updated) })
        .then(() => setDirty(false))
        .catch(console.error);
    }, 500);
  }, []);

  const addType = () => {
    const name = `Type ${types.length + 1}`;
    const updated = [...types, { name, properties: [] }];
    saveTypes(updated);
    setSelectedIdx(updated.length - 1);
  };

  const deleteType = (idx: number) => {
    const updated = types.filter((_, i) => i !== idx);
    saveTypes(updated);
    setSelectedIdx(Math.min(selectedIdx, Math.max(0, updated.length - 1)));
  };

  const updateType = (idx: number, patch: Partial<ObjectType>) => {
    const updated = types.map((t, i) => i === idx ? { ...t, ...patch } : t);
    saveTypes(updated);
  };

  const addProperty = (typeIdx: number) => {
    const t = types[typeIdx];
    const prop: PropertyDef = { key: "", type: "text" };
    updateType(typeIdx, { properties: [...t.properties, prop] });
  };

  const updateProperty = (typeIdx: number, propIdx: number, patch: Partial<PropertyDef>) => {
    const t = types[typeIdx];
    const props = t.properties.map((p, i) => i === propIdx ? { ...p, ...patch } : p);
    updateType(typeIdx, { properties: props });
  };

  const deleteProperty = (typeIdx: number, propIdx: number) => {
    const t = types[typeIdx];
    updateType(typeIdx, { properties: t.properties.filter((_, i) => i !== propIdx) });
  };

  const moveProperty = (typeIdx: number, fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= types[typeIdx].properties.length) return;
    const t = types[typeIdx];
    const props = [...t.properties];
    const [moved] = props.splice(fromIdx, 1);
    props.splice(toIdx, 0, moved);
    updateType(typeIdx, { properties: props });
  };

  const selected = types[selectedIdx];

  return (
    <div className="settings-objects">
      <div className="settings-objects-list">
        <div className="settings-objects-list-header">
          <span>Object Types</span>
          <button className="settings-objects-add" onClick={addType} title="New type">
            <Icon name="plus" size={14} />
          </button>
        </div>
        {types.map((t, i) => (
          <div
            key={i}
            className={`settings-objects-item ${i === selectedIdx ? "active" : ""}`}
            onClick={() => setSelectedIdx(i)}
          >
            <Icon name="box" size={14} />
            <span>{t.name || "Untitled"}</span>
            <span className="settings-objects-count">{t.properties.length}</span>
          </div>
        ))}
        {types.length === 0 && (
          <div className="settings-objects-empty">No types defined</div>
        )}
      </div>
      <div className="settings-objects-detail">
        {selected ? (
          <>
            <div className="settings-objects-detail-header">
              <input
                className="settings-objects-name"
                value={selected.name}
                onChange={(e) => updateType(selectedIdx, { name: e.target.value })}
                placeholder="Type name"
              />
              <button
                className="settings-objects-delete"
                onClick={() => deleteType(selectedIdx)}
                title="Delete type"
              >
                <Icon name="trash-2" size={14} />
              </button>
            </div>
            <div className="settings-objects-props">
              {selected.properties.map((prop, pi) => (
                <div key={pi} className="settings-objects-prop">
                  <div className="settings-objects-prop-row">
                    <div className="settings-objects-prop-arrows">
                      <button
                        className="settings-objects-prop-arrow"
                        onClick={() => moveProperty(selectedIdx, pi, pi - 1)}
                        disabled={pi === 0}
                        title="Move up"
                      >
                        <Icon name="chevron-up" size={12} />
                      </button>
                      <button
                        className="settings-objects-prop-arrow"
                        onClick={() => moveProperty(selectedIdx, pi, pi + 1)}
                        disabled={pi === selected.properties.length - 1}
                        title="Move down"
                      >
                        <Icon name="chevron-down" size={12} />
                      </button>
                    </div>
                    <input
                      className="settings-objects-prop-name"
                      value={prop.key}
                      onChange={(e) => updateProperty(selectedIdx, pi, { key: e.target.value })}
                      placeholder="Property name"
                    />
                    <PropTypeButton
                      type={prop.type}
                      onChange={(newType) => {
                        const patch: Partial<PropertyDef> = { type: newType };
                        if (newType !== "select" && newType !== "multiselect") {
                          patch.options = undefined;
                        }
                        if ((newType === "select" || newType === "multiselect") && !prop.options) {
                          patch.options = [];
                        }
                        updateProperty(selectedIdx, pi, patch);
                      }}
                    />
                    <button
                      className="settings-objects-prop-delete"
                      onClick={() => deleteProperty(selectedIdx, pi)}
                      title="Remove property"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                  {/* Enum options editor for select/multiselect */}
                  {(prop.type === "select" || prop.type === "multiselect") && (
                    <EnumOptionsEditor
                      options={prop.options || []}
                      onChange={(opts) => updateProperty(selectedIdx, pi, { options: opts })}
                    />
                  )}
                  {/* Number min/max */}
                  {prop.type === "number" && (
                    <div className="settings-objects-prop-range">
                      <label>
                        Min
                        <input
                          type="number"
                          value={prop.min ?? ""}
                          onChange={(e) => updateProperty(selectedIdx, pi, {
                            min: e.target.value ? Number(e.target.value) : undefined,
                          })}
                        />
                      </label>
                      <label>
                        Max
                        <input
                          type="number"
                          value={prop.max ?? ""}
                          onChange={(e) => updateProperty(selectedIdx, pi, {
                            max: e.target.value ? Number(e.target.value) : undefined,
                          })}
                        />
                      </label>
                    </div>
                  )}
                </div>
              ))}
              <button className="settings-objects-add-prop" onClick={() => addProperty(selectedIdx)}>
                <Icon name="plus" size={12} />
                Add property
              </button>
            </div>
            {dirty && <div className="settings-objects-saving">Saving...</div>}
          </>
        ) : (
          <div className="settings-objects-empty-detail">
            Select a type or create one
          </div>
        )}
      </div>
    </div>
  );
}

function EnumOptionsEditor({ options, onChange }: { options: string[]; onChange: (opts: string[]) => void }) {
  const [newValue, setNewValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addOption = () => {
    const trimmed = newValue.trim();
    if (!trimmed || options.includes(trimmed)) return;
    onChange([...options, trimmed]);
    setNewValue("");
    inputRef.current?.focus();
  };

  return (
    <div className="settings-objects-enum">
      <div className="settings-objects-enum-pills">
        {options.map((opt, i) => (
          <span key={i} className="settings-objects-enum-pill">
            {opt}
            <button onClick={() => onChange(options.filter((_, j) => j !== i))}>
              <Icon name="x" size={10} />
            </button>
          </span>
        ))}
      </div>
      <input
        ref={inputRef}
        className="settings-objects-enum-input"
        value={newValue}
        onChange={(e) => setNewValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOption(); } }}
        placeholder="Add option..."
      />
    </div>
  );
}

// ── Section: Keybindings ──

function KeybindingsSection() {
  const [bindings, setBindings] = useState<KeyBinding[]>([]);
  const [search, setSearch] = useState("");
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  const commandLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const cmd of getAllCommands()) {
      map.set(cmd.id, cmd.label);
    }
    return map;
  }, []);

  useEffect(() => {
    setBindings(getAllBindings());
    // Load user overrides from disk
    invoke<{ command: string; key: string }[]>("get_keybindings")
      .then((overrides) => {
        for (const o of overrides) {
          setUserOverride(o.command, o.key);
        }
        setBindings(getAllBindings());
      })
      .catch(console.error);
  }, []);

  const filtered = search.trim()
    ? bindings.filter((b) => {
        const label = commandLabels.get(b.id) ?? b.id;
        const q = search.toLowerCase();
        return (
          b.id.toLowerCase().includes(q) ||
          label.toLowerCase().includes(q) ||
          b.key.toLowerCase().includes(q)
        );
      })
    : bindings;

  const saveOverrides = useCallback(() => {
    const overrides = getAllBindings()
      .filter((b) => b.key !== b.defaultKey)
      .map((b) => ({ command: b.id, key: b.key }));
    invoke("save_keybindings", { json: JSON.stringify(overrides) }).catch(
      console.error
    );
  }, []);

  const handleCapture = useCallback(
    (e: KeyboardEvent) => {
      if (!capturingId) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setCapturingId(null);
        setConflictWarning(null);
        return;
      }

      const combo = parseKeyCombo(e);
      if (!combo) return; // modifier-only press

      // Check for conflicts
      const conflicts = getConflicts(combo).filter((id) => id !== capturingId);
      if (conflicts.length > 0) {
        setConflictWarning(`"${combo}" is already used by: ${conflicts.join(", ")}`);
        // Still assign it — user can fix the other one
      } else {
        setConflictWarning(null);
      }

      setUserOverride(capturingId, combo);
      setBindings(getAllBindings());
      setCapturingId(null);
      saveOverrides();
    },
    [capturingId, saveOverrides]
  );

  useEffect(() => {
    if (!capturingId) return;
    window.addEventListener("keydown", handleCapture, true);
    return () => window.removeEventListener("keydown", handleCapture, true);
  }, [capturingId, handleCapture]);

  const handleReset = (id: string) => {
    resetBinding(id);
    setBindings(getAllBindings());
    saveOverrides();
    setConflictWarning(null);
  };

  const handleResetAll = () => {
    resetAll();
    setBindings(getAllBindings());
    saveOverrides();
    setConflictWarning(null);
  };

  // Group by category (derived from command ID prefix)
  const getCategory = (id: string) => {
    const dot = id.indexOf(".");
    if (dot === -1) return "Other";
    const prefix = id.slice(0, dot);
    return prefix.charAt(0).toUpperCase() + prefix.slice(1);
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Keybindings</h2>

      <input
        type="text"
        className="settings-keybind-search"
        placeholder="Search keybindings..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {conflictWarning && (
        <div className="settings-conflict-warning">{conflictWarning}</div>
      )}

      <div className="settings-keybind-table" ref={captureRef}>
        <div className="settings-keybind-header">
          <span className="settings-keybind-col-cmd">Command</span>
          <span className="settings-keybind-col-cat">Category</span>
          <span className="settings-keybind-col-key">Shortcut</span>
          <span className="settings-keybind-col-def">Default</span>
          <span className="settings-keybind-col-act" />
        </div>
        {filtered.map((b) => {
          const isOverridden = b.key !== b.defaultKey;
          const isCapturing = capturingId === b.id;
          return (
            <div key={b.id} className="settings-keybind-row">
              <span className="settings-keybind-col-cmd" title={b.id}>
                {commandLabels.get(b.id) ?? b.id}
              </span>
              <span className="settings-keybind-col-cat">
                {getCategory(b.id)}
              </span>
              <span
                className={`settings-keybind-col-key settings-keybind-capture ${
                  isCapturing ? "capturing" : ""
                } ${isOverridden ? "overridden" : ""}`}
                onClick={() => {
                  setCapturingId(b.id);
                  setConflictWarning(null);
                }}
                title="Click to rebind"
              >
                {isCapturing ? "Press a key..." : b.key || "—"}
              </span>
              <span className="settings-keybind-col-def">{b.defaultKey}</span>
              <span className="settings-keybind-col-act">
                {isOverridden && (
                  <button
                    className="settings-keybind-reset"
                    onClick={() => handleReset(b.id)}
                    title="Reset to default"
                  >
                    Reset
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="settings-keybind-footer">
        <button className="settings-btn-secondary" onClick={handleResetAll}>
          Reset All
        </button>
      </div>
    </div>
  );
}

// ── Section: About ──

function AboutSection() {
  return (
    <div className="settings-section settings-about">
      <h2 className="settings-section-title">About</h2>
      <div className="settings-about-content">
        <div className="settings-about-name">Onyx</div>
        <div className="settings-about-version">
          Version {__APP_VERSION__}
        </div>
        <div className="settings-about-desc">
          Lightweight, offline-first markdown note-taking.
        </div>
        <div className="settings-about-tech">
          Tauri 2 + React 18 + CodeMirror 6 + SQLite
        </div>
        <div className="settings-about-credits">
          Built with{" "}
          <a href="https://codemirror.net" target="_blank" rel="noreferrer">CodeMirror</a>,{" "}
          <a href="https://v2.tauri.app" target="_blank" rel="noreferrer">Tauri</a>,{" "}
          <a href="https://react.dev" target="_blank" rel="noreferrer">React</a>,{" "}
          <a href="https://zustand.docs.pmnd.rs" target="_blank" rel="noreferrer">Zustand</a>,{" "}
          <a href="https://lucide.dev" target="_blank" rel="noreferrer">Lucide</a>,{" "}
          and{" "}
          <a href="https://github.com/tgrosinger/md-advanced-tables" target="_blank" rel="noreferrer">md-advanced-tables</a>
        </div>
      </div>
    </div>
  );
}
