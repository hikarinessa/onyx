import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

type Section = "general" | "editor" | "appearance" | "keybindings" | "about";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "settings" },
  { id: "editor", label: "Editor", icon: "type" },
  { id: "appearance", label: "Appearance", icon: "palette" },
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
        ) as AppConfig;
        applyConfig(next);
        return next;
      });
    },
    []
  );

  if (!visible || !config) return null;

  return (
    <div className="settings-overlay" onClick={() => setVisible(false)}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
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
          {section === "keybindings" && <KeybindingsSection />}
          {section === "about" && <AboutSection />}
        </div>
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
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className={`settings-toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
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

      <SettingRow label="Default new note location">
        <select
          className="settings-select"
          value={config.behavior.new_note_location}
          onChange={(e) =>
            updateConfig({ behavior: { new_note_location: e.target.value } })
          }
        >
          <option value="first_dir">First directory</option>
          <option value="active_dir">Active directory</option>
        </select>
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
  const unlimited = config.editor.content_max_width === null;

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Editor</h2>

      <SettingRow label="Font family">
        <input
          type="text"
          className="settings-text-input"
          value={config.editor.font_family}
          placeholder="Literata"
          onChange={(e) =>
            updateConfig({ editor: { font_family: e.target.value } })
          }
        />
      </SettingRow>

      <SettingRow label="Font size" description={`${config.editor.font_size}px`}>
        <input
          type="range"
          className="settings-range"
          min={12}
          max={24}
          step={1}
          value={config.editor.font_size}
          onChange={(e) =>
            updateConfig({ editor: { font_size: Number(e.target.value) } })
          }
        />
        <span className="settings-range-value">{config.editor.font_size}px</span>
      </SettingRow>

      <SettingRow label="Line height" description={`${config.editor.line_height.toFixed(1)}`}>
        <input
          type="range"
          className="settings-range"
          min={1.2}
          max={2.4}
          step={0.1}
          value={config.editor.line_height}
          onChange={(e) =>
            updateConfig({ editor: { line_height: Number(e.target.value) } })
          }
        />
        <span className="settings-range-value">
          {config.editor.line_height.toFixed(1)}
        </span>
      </SettingRow>

      <SettingRow
        label="Content max width"
        description={unlimited ? "Unlimited" : `${config.editor.content_max_width}px`}
      >
        <label className="settings-inline-toggle">
          <Toggle
            checked={unlimited}
            onChange={(v) =>
              updateConfig({
                editor: { content_max_width: v ? null : 720 },
              })
            }
          />
          <span className="settings-inline-label">Unlimited</span>
        </label>
        {!unlimited && (
          <>
            <input
              type="range"
              className="settings-range"
              min={500}
              max={1200}
              step={10}
              value={config.editor.content_max_width ?? 720}
              onChange={(e) =>
                updateConfig({
                  editor: { content_max_width: Number(e.target.value) },
                })
              }
            />
            <span className="settings-range-value">
              {config.editor.content_max_width}px
            </span>
          </>
        )}
      </SettingRow>

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

      <SettingRow label="Show line numbers" description="Takes effect on restart">
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
    </div>
  );
}

// ── Section: Appearance ──

const THEME_SWATCHES: Record<string, { bg: string; surface: string; accent: string; text: string }> = {
  dark: { bg: "#0e0e12", surface: "#1a1a20", accent: "#8b7cf6", text: "#e8e8ec" },
  light: { bg: "#ffffff", surface: "#eeeef0", accent: "#6b5ce7", text: "#1d1d1f" },
  warm2: { bg: "#232323", surface: "#2d2d2d", accent: "#00a3d7", text: "#ebebeb" },
  warm: { bg: "#1c1917", surface: "#292523", accent: "#d4a574", text: "#ede8e3" },
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
      </div>
    </div>
  );
}
