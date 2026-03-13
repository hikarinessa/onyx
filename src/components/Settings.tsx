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

// ── Types ──

interface Config {
  editor: {
    font_family: string;
    font_size: number;
    line_height: number;
    content_max_width: number | null;
    default_mode: string;
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
    new_note_location: string;
  };
}

type Section = "general" | "editor" | "appearance" | "keybindings" | "about";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "appearance", label: "Appearance" },
  { id: "keybindings", label: "Keybindings" },
  { id: "about", label: "About" },
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
  const [config, setConfig] = useState<Config | null>(null);

  // Load config on open
  useEffect(() => {
    if (!visible) return;
    setSection("general");
    invoke<Config>("get_config").then(setConfig).catch(console.error);
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
      // Optimistic local update + apply to live UI
      setConfig((prev) => {
        if (!prev) return prev;
        const next = JSON.parse(JSON.stringify(prev));
        for (const [key, val] of Object.entries(partial)) {
          if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            next[key] = { ...next[key], ...(val as Record<string, unknown>) };
          } else {
            next[key] = val;
          }
        }
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

// ── Section: General ──

function GeneralSection({
  config,
  updateConfig,
}: {
  config: Config;
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
  config: Config;
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
  warm: { bg: "#1c1917", surface: "#292523", accent: "#d4a574", text: "#ede8e3" },
};

function AppearanceSection({
  config,
  updateConfig,
}: {
  config: Config;
  updateConfig: (partial: Record<string, unknown>) => void;
}) {
  const themes = getAvailableThemes();
  const activeTheme = getActiveThemeId();

  const handleThemeChange = (themeId: string) => {
    applyTheme(themeId);
    updateConfig({ appearance: { theme: themeId } });
  };

  return (
    <div className="settings-section">
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
                <div
                  className="settings-theme-preview"
                  style={{ background: sw.bg }}
                >
                  <div
                    className="settings-theme-swatch-bar"
                    style={{ background: sw.surface }}
                  />
                  <div
                    className="settings-theme-swatch-accent"
                    style={{ background: sw.accent }}
                  />
                  <div
                    className="settings-theme-swatch-text"
                    style={{ background: sw.text }}
                  />
                </div>
                <span className="settings-theme-label">{t.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <SettingRow
        label="Sidebar width"
        description={`${config.appearance.sidebar_width}px`}
      >
        <input
          type="range"
          className="settings-range"
          min={180}
          max={400}
          step={10}
          value={config.appearance.sidebar_width}
          onChange={(e) =>
            updateConfig({ appearance: { sidebar_width: Number(e.target.value) } })
          }
        />
        <span className="settings-range-value">
          {config.appearance.sidebar_width}px
        </span>
      </SettingRow>

      <SettingRow
        label="Context panel width"
        description={`${config.appearance.context_panel_width}px`}
      >
        <input
          type="range"
          className="settings-range"
          min={220}
          max={400}
          step={10}
          value={config.appearance.context_panel_width}
          onChange={(e) =>
            updateConfig({
              appearance: { context_panel_width: Number(e.target.value) },
            })
          }
        />
        <span className="settings-range-value">
          {config.appearance.context_panel_width}px
        </span>
      </SettingRow>

      <SettingRow label="UI font override">
        <input
          type="text"
          className="settings-text-input"
          value={config.appearance.ui_font ?? ""}
          placeholder="DM Sans"
          onChange={(e) =>
            updateConfig({
              appearance: { ui_font: e.target.value || null },
            })
          }
        />
      </SettingRow>

      <SettingRow label="Mono font override">
        <input
          type="text"
          className="settings-text-input"
          value={config.appearance.mono_font ?? ""}
          placeholder="IBM Plex Mono"
          onChange={(e) =>
            updateConfig({
              appearance: { mono_font: e.target.value || null },
            })
          }
        />
      </SettingRow>
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
