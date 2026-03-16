import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, selectActiveTabPath, selectActiveTabName, selectAllTabs, type AccordionState } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";
import { replaceTabContent } from "./Editor";
import { Calendar } from "./Calendar";
import { createOrOpenPeriodicNote } from "../lib/periodicNotes";
import { getCached, setCache } from "../lib/ipcCache";
import { Icon } from "./Icon";
import * as fileOps from "../lib/fileOps";

// ── Types ──

interface BacklinkRecord {
  source_path: string;
  source_title: string | null;
  line_number: number | null;
  context: string | null;
}

interface ObjectType {
  name: string;
  properties: PropertyDef[];
}

interface PropertyDef {
  key: string;
  type: "text" | "date" | "number" | "select" | "multiselect" | "tags" | "checkbox" | "link";
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
}

type FrontmatterValue = string | number | boolean | string[] | null | undefined;
type FrontmatterMap = Record<string, FrontmatterValue>;

// ── Tags field (edits raw text, commits array on blur) ──

function TagsField({ value, onChange }: { value: FrontmatterValue; onChange: (val: FrontmatterValue) => void }) {
  const initial = Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : "";
  const [raw, setRaw] = useState(initial);
  const [editing, setEditing] = useState(false);

  // Sync from outside when not editing
  useEffect(() => {
    if (!editing) {
      setRaw(Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : "");
    }
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    if (raw.trim() === "") {
      onChange(null);
    } else {
      onChange(raw.split(",").map((t) => t.trim()).filter(Boolean));
    }
  };

  return (
    <input
      type="text"
      className="prop-input"
      placeholder="tag1, tag2, ..."
      value={raw}
      onFocus={() => setEditing(true)}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

// ── Property field widgets ──

function PropertyField({
  def,
  value,
  onChange,
}: {
  def: PropertyDef;
  value: FrontmatterValue;
  onChange: (val: FrontmatterValue) => void;
}) {
  switch (def.type) {
    case "checkbox":
      return (
        <label className="prop-checkbox-label">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="prop-checkbox"
          />
        </label>
      );

    case "date":
      return (
        <input
          type="date"
          className="prop-input prop-input-date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );

    case "number":
      return (
        <input
          type="number"
          className="prop-input prop-input-number"
          value={typeof value === "number" ? value : ""}
          min={def.min}
          max={def.max}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : Number(v));
          }}
        />
      );

    case "select":
      return (
        <select
          className="prop-input prop-select"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">—</option>
          {(def.options || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case "multiselect": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="prop-multiselect">
          {(def.options || []).map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label key={opt} className="prop-multiselect-option">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((s) => s !== opt)
                      : [...selected, opt];
                    onChange(next.length > 0 ? next : null);
                  }}
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      );
    }

    case "tags":
      return <TagsField value={value} onChange={onChange} />;

    case "link":
    case "text":
    default:
      return (
        <input
          type="text"
          className="prop-input"
          value={typeof value === "string" ? value : value == null ? "" : String(value)}
          placeholder={def.type === "link" ? "[[Note]]" : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

// ── Properties section ──

/** Context menu that clamps itself to viewport bounds */
function ClampedMenu({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - pad),
      y: Math.min(y, window.innerHeight - rect.height - pad),
    });
  }, [x, y]);
  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y, position: "fixed", zIndex: 1100 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

const PROP_TYPES = [
  { value: "text", label: "Text", icon: "type" },
  { value: "number", label: "Number", icon: "hash" },
  { value: "date", label: "Date", icon: "calendar" },
  { value: "checkbox", label: "Checkbox", icon: "check-square" },
  { value: "select", label: "Select", icon: "list" },
  { value: "multiselect", label: "Multi-select", icon: "list-checks" },
  { value: "tags", label: "Tags", icon: "tag" },
  { value: "link", label: "Link", icon: "link" },
];

function iconForType(type: string): string {
  return PROP_TYPES.find((t) => t.value === type)?.icon || "type";
}

function inferPropertyType(val: unknown): string {
  if (Array.isArray(val)) return "tags";
  if (typeof val === "boolean") return "checkbox";
  if (typeof val === "number") return "number";
  return "text";
}

function AddPropertyRow({ onAdd }: { onAdd: (key: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const submit = () => {
    const trimmed = key.trim();
    if (trimmed) {
      onAdd(trimmed);
      setKey("");
      setAdding(false);
    }
  };

  if (!adding) {
    return (
      <button className="prop-add" onClick={() => setAdding(true)}>
        <Icon name="plus" size={12} />
        Add property
      </button>
    );
  }

  return (
    <div className="prop-add-row">
      <input
        ref={inputRef}
        className="prop-add-input"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          if (e.key === "Escape") { setAdding(false); setKey(""); }
        }}
        onBlur={() => { if (!key.trim()) setAdding(false); }}
        placeholder="Property name"
      />
    </div>
  );
}

function PropertiesSection({
  path,
  expanded,
  onToggle,
  onTypeDetected,
  saveVersion,
}: {
  path: string;
  expanded: boolean;
  onToggle: () => void;
  onTypeDetected: (hasType: boolean) => void;
  saveVersion: number;
}) {
  const [frontmatter, setFrontmatter] = useState<FrontmatterMap | null>(null);
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-property type overrides for untyped notes (user right-click to change)
  const [typeOverrides, setTypeOverrides] = useState<Record<string, string>>({});
  const [propTypeMenu, setPropTypeMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [typeAssignMenu, setTypeAssignMenu] = useState<{ x: number; y: number } | null>(null);

  // Load frontmatter + object types when path or saveVersion changes
  useEffect(() => {
    let stale = false;
    setLoading(true);

    Promise.all([
      invoke<string | null>("get_file_frontmatter", { path }),
      invoke<ObjectType[]>("get_object_types"),
    ])
      .then(([fmJson, types]) => {
        if (stale) return;
        let parsed: FrontmatterMap | null = null;
        if (fmJson) {
          try {
            const obj = JSON.parse(fmJson);
            parsed = obj && typeof obj === "object" ? obj : null;
          } catch {
            // ignore
          }
        }
        setFrontmatter(parsed);
        setObjectTypes(types);
        setLoading(false);
        onTypeDetected(!!(parsed && parsed.type));
      })
      .catch(() => {
        if (stale) return;
        setFrontmatter(null);
        setObjectTypes([]);
        setLoading(false);
        onTypeDetected(false);
      });

    return () => {
      stale = true;
    };
  }, [path, saveVersion]);

  // Cancel pending save on path change or unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [path]);

  const scheduleSave = useCallback(
    (updated: FrontmatterMap) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await invoke("update_frontmatter", {
            path,
            frontmatterJson: JSON.stringify(updated),
          });
          // Sync the editor: read file back from disk so CM6 has the new frontmatter
          const content = await invoke<string>("read_file", { path });
          // Find tab ID by path across all panes (compat getter is broken)
          const allTabs = selectAllTabs(useAppStore.getState());
          const tab = allTabs.find((t) => t.path === path);
          if (tab) {
            replaceTabContent(tab.id, content);
          }
        } catch (err) {
          console.error("Failed to update frontmatter:", err);
        }
      }, 500);
    },
    [path],
  );

  // Close menus on outside click
  useEffect(() => {
    const active = propTypeMenu || typeAssignMenu;
    if (!active) return;
    const close = () => { setPropTypeMenu(null); setTypeAssignMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [propTypeMenu, typeAssignMenu]);

  const handleChangePropertyType = useCallback(
    (key: string, newType: string) => {
      setTypeOverrides((prev) => ({ ...prev, [key]: newType }));
      // Convert the value to match the new type
      setFrontmatter((prev) => {
        if (!prev) return prev;
        const oldVal = prev[key];
        let newVal: FrontmatterValue = oldVal;
        if (newType === "checkbox") newVal = Boolean(oldVal);
        else if (newType === "number") newVal = Number(oldVal) || 0;
        else if (newType === "tags") newVal = Array.isArray(oldVal) ? oldVal : oldVal ? [String(oldVal)] : [];
        else if (newType === "text" || newType === "link") newVal = oldVal != null ? String(oldVal) : "";
        else if (newType === "date") newVal = typeof oldVal === "string" ? oldVal : "";
        const updated = { ...prev, [key]: newVal };
        scheduleSave(updated);
        return updated;
      });
      setPropTypeMenu(null);
    },
    [scheduleSave],
  );

  const handleChange = useCallback(
    (key: string, val: FrontmatterValue) => {
      setFrontmatter((prev) => {
        const updated = { ...prev, [key]: val };
        if (val == null) delete updated[key];
        scheduleSave(updated);
        return updated;
      });
    },
    [scheduleSave],
  );

  // Determine display mode
  const typeName = frontmatter?.type as string | undefined;
  const matchedType = typeName
    ? objectTypes.find((t) => t.name.toLowerCase() === typeName.toLowerCase())
    : undefined;

  const handleAssignType = useCallback(
    (typeName: string | null) => {
      setFrontmatter((prev) => {
        const updated = { ...prev };
        if (typeName) {
          updated.type = typeName.toLowerCase();
        } else {
          delete updated.type;
        }
        scheduleSave(updated);
        return updated;
      });
      setTypeAssignMenu(null);
    },
    [scheduleSave],
  );

  return (
    <div className="context-panel-section">
      <div
        className="context-panel-section-title collapsible"
        onClick={onToggle}
      >
        <span className="collapse-arrow"><Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} /></span>
        <Icon name="list" size={14} />
        Properties
        {frontmatter && (() => {
          const count = Object.keys(frontmatter).filter((k) => k !== "type").length;
          return count > 0 ? ` (${count})` : null;
        })()}
        {matchedType && (
          <span
            className="prop-type-badge"
            title="Right-click to change or remove type"
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setTypeAssignMenu({ x: e.clientX, y: e.clientY }); }}
          >
            {matchedType.name}
          </span>
        )}
        {!matchedType && !loading && objectTypes.length > 0 && (
          <button
            className="prop-type-assign"
            title="Assign an object type"
            onClick={(e) => { e.stopPropagation(); setTypeAssignMenu({ x: e.clientX, y: e.clientY }); }}
          >
            <Icon name="plus" size={10} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="properties-list">
          {loading ? (
            <div className="properties-empty">Loading...</div>
          ) : !frontmatter ? (
            <div className="properties-empty">No properties</div>
          ) : matchedType ? (
            <>
              {/* Typed: render all defined properties (even empty ones) */}
              {matchedType.properties.map((def) => (
                <div key={def.key} className="prop-row">
                  <div className="prop-label prop-label-typed" title={`${def.key} (${def.type}) — defined by ${matchedType.name}`}>
                    <Icon name={iconForType(def.type)} size={10} />
                    {def.key}
                    {def.required && <span className="prop-required">*</span>}
                  </div>
                  <div className="prop-value">
                    <PropertyField
                      def={def}
                      value={frontmatter[def.key]}
                      onChange={(v) => handleChange(def.key, v)}
                    />
                  </div>
                </div>
              ))}
              {/* Extra keys not in the type definition */}
              {Object.entries(frontmatter)
                .filter(([key]) => key !== "type" && !matchedType.properties.some((p) => p.key === key))
                .map(([key, val]) => {
                  const effectiveType = typeOverrides[key] || inferPropertyType(val);
                  return (
                    <div key={key} className="prop-row prop-row-extra">
                      <div
                        className="prop-label"
                        title={`${key} (${effectiveType}) — click to change type`}
                        onContextMenu={(e) => { e.preventDefault(); setPropTypeMenu({ key, x: e.clientX, y: e.clientY }); }}
                      >
                        <Icon name={iconForType(effectiveType)} size={10} />
                        {key}
                      </div>
                      <div className="prop-value">
                        <PropertyField
                          def={{ key, type: effectiveType }}
                          value={val}
                          onChange={(v) => handleChange(key, v)}
                        />
                      </div>
                      <button className="prop-delete" onClick={() => handleChange(key, null)} title="Remove">
                        <Icon name="x" size={10} />
                      </button>
                    </div>
                  );
                })}
            </>
          ) : (
            <>
              {/* Untyped: raw key-value editor — right-click label to change type */}
              {Object.entries(frontmatter).map(([key, val]) => {
                const effectiveType = typeOverrides[key] || inferPropertyType(val);
                return (
                  <div key={key} className="prop-row">
                    <div
                      className="prop-label"
                      title={`${key} (${effectiveType}) — click to change type`}
                      onContextMenu={(e) => { e.preventDefault(); setPropTypeMenu({ key, x: e.clientX, y: e.clientY }); }}
                    >
                      <Icon name={iconForType(effectiveType)} size={10} />
                      {key}
                    </div>
                    <div className="prop-value">
                      <PropertyField
                        def={{ key, type: effectiveType }}
                        value={val}
                        onChange={(v) => handleChange(key, v)}
                      />
                    </div>
                    <button className="prop-delete" onClick={() => handleChange(key, null)} title="Remove">
                      <Icon name="x" size={10} />
                    </button>
                  </div>
                );
              })}
            </>
          )}
          {/* Add property row */}
          <AddPropertyRow onAdd={(key) => handleChange(key, "")} />
          {/* Property type picker menu */}
          {propTypeMenu && (
            <ClampedMenu x={propTypeMenu.x} y={propTypeMenu.y}>
              {PROP_TYPES.map((pt) => (
                <div
                  key={pt.value}
                  className={`context-menu-item ${(typeOverrides[propTypeMenu.key] || inferPropertyType(frontmatter?.[propTypeMenu.key])) === pt.value ? "active" : ""}`}
                  onClick={() => handleChangePropertyType(propTypeMenu.key, pt.value)}
                >
                  <Icon name={pt.icon} size={12} />
                  <span style={{ marginLeft: 6 }}>{pt.label}</span>
                </div>
              ))}
            </ClampedMenu>
          )}
          {/* Type assign/change menu */}
          {typeAssignMenu && (
            <ClampedMenu x={typeAssignMenu.x} y={typeAssignMenu.y}>
              {objectTypes.map((t) => (
                <div
                  key={t.name}
                  className={`context-menu-item ${matchedType?.name === t.name ? "active" : ""}`}
                  onClick={() => handleAssignType(t.name)}
                >
                  <Icon name="box" size={12} />
                  <span style={{ marginLeft: 6 }}>{t.name}</span>
                </div>
              ))}
              {matchedType && (
                <>
                  <div className="context-menu-separator" />
                  <div className="context-menu-item destructive" onClick={() => handleAssignType(null)}>
                    <Icon name="x" size={12} />
                    <span style={{ marginLeft: 6 }}>Remove type</span>
                  </div>
                </>
              )}
            </ClampedMenu>
          )}
        </div>
      )}
    </div>
  );
}

// ── Recent Documents ──

function RecentDocuments({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const [recents, setRecents] = useState<{ path: string; name: string }[]>([]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    import("../lib/recentDocs").then((mod) => {
      setRecents(mod.getRecentDocs());
      unsub = mod.subscribeRecentDocs(() => {
        setRecents(mod.getRecentDocs());
      });
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);

  return (
    <div className="context-panel-section">
      <div
        className="context-panel-section-title collapsible"
        onClick={onToggle}
      >
        <span className="collapse-arrow"><Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} /></span>
        <Icon name="clock" size={14} />
        Recent ({recents.length})
      </div>
      {expanded && (
        <div className="recent-docs-list">
          {recents.length === 0 ? (
            <div className="backlinks-empty">No recent documents</div>
          ) : (
            recents.map((doc) => (
              <div
                key={doc.path}
                className="tree-item"
                style={{ "--indent": 0 } as React.CSSProperties}
                title={doc.path}
                onClick={async (e) => {
                  try {
                    await openFileInEditor(doc.path, doc.name, { replaceActive: !e.metaKey });
                  } catch (err) {
                    console.error("Failed to open recent doc:", err);
                  }
                }}
              >
                <span className="tree-item-icon"><Icon name="file-text" size={14} /></span>
                <span className="tree-item-label">{doc.name}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Accordion hook ──

/** Resolve effective expanded state: user override or smart default */
function useAccordionSection(
  section: keyof AccordionState,
  smartDefault: boolean,
): [boolean, () => void] {
  const override = useAppStore((s) => s.accordionState[section]);
  const setExpanded = useAppStore((s) => s.setAccordionExpanded);
  const expanded = override !== null ? override : smartDefault;
  const toggle = useCallback(() => {
    setExpanded(section, !expanded);
  }, [section, expanded, setExpanded]);
  return [expanded, toggle];
}

// ── Main component ──

export function ContextPanel() {
  const visible = useAppStore((s) => s.contextPanelVisible);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTabPath = useAppStore(selectActiveTabPath);
  const activeTabName = useAppStore(selectActiveTabName);
  const saveVersion = useAppStore((s) => s.saveVersion);
  const fileTreeVersion = useAppStore((s) => s.fileTreeVersion);

  const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [hasType, setHasType] = useState(false);

  // Accordion sections with store persistence
  const [propsExpanded, toggleProps] = useAccordionSection("properties", hasType);
  const [backlinksExpanded, toggleBacklinks] = useAccordionSection("backlinks", !hasType);
  const [recentExpanded, toggleRecent] = useAccordionSection("recent", false);

  const handleTypeDetected = useCallback((detected: boolean) => {
    setHasType(detected);
  }, []);

  // Fetch backlinks (with IPC cache)
  useEffect(() => {
    let stale = false;

    if (!activeTabPath) {
      setBacklinks([]);
      return () => { stale = true; };
    }

    const cacheKey = `backlinks:${activeTabPath}`;
    const cached = getCached<BacklinkRecord[]>(cacheKey);
    if (cached) {
      setBacklinks(cached);
      return () => { stale = true; };
    }

    invoke<BacklinkRecord[]>("get_backlinks", { path: activeTabPath })
      .then((results) => {
        if (stale) return;
        setCache(cacheKey, results);
        setBacklinks(results);
      })
      .catch(() => {
        if (stale) return;
        setBacklinks([]);
      });
    return () => { stale = true; };
  }, [activeTabId, fileTreeVersion]);

  // Check bookmark state (directory bookmark OR global bookmark)
  useEffect(() => {
    if (!activeTabPath) {
      setIsBookmarked(false);
      return;
    }

    Promise.all([
      invoke<boolean>("is_file_bookmarked", { path: activeTabPath }).catch(() => false),
      invoke<boolean>("is_global_bookmarked", { path: activeTabPath }).catch(() => false),
    ]).then(([dir, global]) => setIsBookmarked(dir || global));
  }, [activeTabId]);

  const handleBacklinkClick = async (record: BacklinkRecord, newTab: boolean) => {
    const name = record.source_title
      || record.source_path.split("/").pop()
      || record.source_path;
    try {
      await openFileInEditor(record.source_path, name, { replaceActive: !newTab });
    } catch (err) {
      console.error("Failed to open backlink source:", err);
    }
  };

  const handleToggleBookmark = async () => {
    if (!activeTabPath) return;
    try {
      // Try directory bookmark first (file is indexed)
      const nowBookmarked = await invoke<boolean>("toggle_bookmark", {
        path: activeTabPath,
      });
      setIsBookmarked(nowBookmarked);
      useAppStore.getState().bumpBookmarkVersion();
    } catch {
      // File not in a registered directory — use global bookmark
      try {
        const label = activeTabName || activeTabPath.split("/").pop() || activeTabPath;
        const nowBookmarked = await invoke<boolean>("toggle_global_bookmark", {
          path: activeTabPath,
          label,
        });
        setIsBookmarked(nowBookmarked);
        useAppStore.getState().bumpBookmarkVersion();
      } catch (err) {
        console.error("Failed to toggle bookmark:", err);
      }
    }
  };

  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarMenu, setCalendarMenu] = useState<{ isoDate: string; x: number; y: number } | null>(null);
  const creatingRef = useRef(false);

  const handleDateClick = async (isoDate: string, newTab: boolean) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCalendarError(null);
    try {
      await createOrOpenPeriodicNote("daily", isoDate, { newTab });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("not configured") || msg.includes("not enabled")) {
        setCalendarError("Enable daily notes in ~/.onyx/periodic-notes.json");
      } else {
        setCalendarError(msg);
      }
    } finally {
      creatingRef.current = false;
    }
  };

  const handleWeekClick = async (isoWeek: string, newTab: boolean) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCalendarError(null);
    try {
      await createOrOpenPeriodicNote("weekly", isoWeek, { newTab });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("not configured") || msg.includes("not enabled")) {
        setCalendarError("Enable weekly notes in ~/.onyx/periodic-notes.json");
      } else {
        setCalendarError(msg);
      }
    } finally {
      creatingRef.current = false;
    }
  };

  const handleDateContextMenu = useCallback((isoDate: string, hasNote: boolean, x: number, y: number) => {
    if (!hasNote) return;
    setCalendarMenu({ isoDate, x, y });
  }, []);

  // Close calendar context menu on outside click
  useEffect(() => {
    if (!calendarMenu) return;
    const close = () => setCalendarMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [calendarMenu]);

  const handleDeletePeriodicNote = useCallback(async (isoDate: string) => {
    setCalendarMenu(null);
    try {
      // Use create_periodic_note to resolve the path (returns existing file without creating)
      const result = await invoke<{ path: string; created: boolean }>("create_periodic_note", {
        periodType: "daily",
        date: isoDate,
      });
      if (!result.created) {
        await fileOps.deleteFile(result.path);
      }
    } catch (err) {
      console.error("Failed to delete periodic note:", err);
    }
  }, []);

  return (
    <div className={`context-panel ${visible ? "" : "collapsed"}`}>
      {/* Calendar — pinned */}
      <div className="context-panel-pinned">
        <Calendar onDateClick={handleDateClick} onWeekClick={handleWeekClick} onDateContextMenu={handleDateContextMenu} />
        {calendarError && (
          <div className="calendar-error">{calendarError}</div>
        )}
        {calendarMenu && (
          <ClampedMenu x={calendarMenu.x} y={calendarMenu.y}>
            <div className="context-menu-item destructive" onClick={() => handleDeletePeriodicNote(calendarMenu.isoDate)}>
              Delete daily note
            </div>
          </ClampedMenu>
        )}
      </div>

      {/* Scrollable content */}
      <div className="context-panel-scrollable">
      {/* Bookmark toggle button */}
      {activeTabPath && (
        <div className="context-panel-bookmark-row">
          <button
            className={`context-panel-bookmark-btn ${isBookmarked ? "active" : ""}`}
            title={isBookmarked ? "Remove bookmark" : "Bookmark this note"}
            onClick={handleToggleBookmark}
          >
            <Icon name={isBookmarked ? "bookmark-check" : "bookmark"} size={16} />
          </button>
          <span className="context-panel-bookmark-label">
            {isBookmarked ? "Bookmarked" : "Bookmark"}
          </span>
        </div>
      )}

      {/* Properties section */}
      {activeTabPath && (
        <PropertiesSection
          path={activeTabPath}
          expanded={propsExpanded}
          onToggle={toggleProps}
          onTypeDetected={handleTypeDetected}
          saveVersion={saveVersion}
        />
      )}

      {/* Backlinks section */}
      <div className="context-panel-section">
        <div
          className="context-panel-section-title collapsible"
          onClick={toggleBacklinks}
        >
          <span className="collapse-arrow"><Icon name={backlinksExpanded ? "chevron-down" : "chevron-right"} size={14} /></span>
          <Icon name="link" size={14} />
          Backlinks ({backlinks.length})
        </div>

        {backlinksExpanded && (
          <div className="backlinks-list">
            {backlinks.length === 0 ? (
              <div className="backlinks-empty">No backlinks</div>
            ) : (
              backlinks.map((record, i) => {
                const title =
                  record.source_title ||
                  record.source_path.split("/").pop() ||
                  record.source_path;
                return (
                  <div
                    key={`${record.source_path}-${i}`}
                    className="backlink-item"
                    onClick={(e) => handleBacklinkClick(record, e.metaKey)}
                  >
                    <div className="backlink-title">{title}</div>
                    {record.context && (
                      <div className="backlink-context">{record.context}</div>
                    )}
                    {record.line_number != null && (
                      <div className="backlink-line">line {record.line_number}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Recent Documents */}
      <RecentDocuments expanded={recentExpanded} onToggle={toggleRecent} />
      </div>
    </div>
  );
}
