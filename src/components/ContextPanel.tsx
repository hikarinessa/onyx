import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";

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

    case "tags": {
      const tagStr = Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : "";
      return (
        <input
          type="text"
          className="prop-input"
          placeholder="tag1, tag2, ..."
          value={tagStr}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw.trim() === "") {
              onChange(null);
            } else {
              onChange(raw.split(",").map((t) => t.trim()).filter(Boolean));
            }
          }}
        />
      );
    }

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

function PropertiesSection({
  path,
  expanded,
  onToggle,
  onTypeDetected,
}: {
  path: string;
  expanded: boolean;
  onToggle: () => void;
  onTypeDetected: (hasType: boolean) => void;
}) {
  const [frontmatter, setFrontmatter] = useState<FrontmatterMap | null>(null);
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load frontmatter + object types when path changes
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
  }, [path]);

  // Cancel pending save on path change or unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [path]);

  const scheduleSave = useCallback(
    (updated: FrontmatterMap) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        invoke("update_frontmatter", {
          path,
          frontmatterJson: JSON.stringify(updated),
        }).catch((err) => console.error("Failed to update frontmatter:", err));
      }, 500);
    },
    [path],
  );

  const handleChange = useCallback(
    (key: string, val: FrontmatterValue) => {
      setFrontmatter((prev) => {
        const updated = { ...prev, [key]: val };
        // Remove null/undefined keys for cleanliness
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

  const label = frontmatter
    ? matchedType
      ? `Properties (${matchedType.name})`
      : "Properties"
    : "Properties";

  return (
    <div className="context-panel-section">
      <div
        className="context-panel-section-title collapsible"
        onClick={onToggle}
      >
        <span className="collapse-arrow">{expanded ? "▾" : "▸"}</span>
        {label}
      </div>

      {expanded && (
        <div className="properties-list">
          {loading ? (
            <div className="properties-empty">Loading...</div>
          ) : !frontmatter ? (
            <div className="properties-empty">No properties</div>
          ) : matchedType ? (
            // Typed: render fields from object type definition
            matchedType.properties.map((def) => (
              <div key={def.key} className="prop-row">
                <div className="prop-label" title={def.key}>
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
            ))
          ) : (
            // Untyped: raw key-value editor for all frontmatter
            Object.entries(frontmatter).map(([key, val]) => (
              <div key={key} className="prop-row">
                <div className="prop-label" title={key}>
                  {key}
                </div>
                <div className="prop-value">
                  <PropertyField
                    def={{ key, type: "text" }}
                    value={typeof val === "object" && val !== null ? JSON.stringify(val) : val}
                    onChange={(v) => handleChange(key, v)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──

export function ContextPanel() {
  const visible = useAppStore((s) => s.contextPanelVisible);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([]);
  const [backlinksExpanded, setBacklinksExpanded] = useState(false);
  const [propsExpanded, setPropsExpanded] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);

  // Reset accordion defaults on tab switch
  const handleTypeDetected = useCallback((hasType: boolean) => {
    setPropsExpanded(hasType);
    setBacklinksExpanded(!hasType);
  }, []);

  // Fetch backlinks
  useEffect(() => {
    if (!activeTab?.path) {
      setBacklinks([]);
      setBacklinksExpanded(false);
      setPropsExpanded(false);
      return;
    }

    let stale = false;
    invoke<BacklinkRecord[]>("get_backlinks", { path: activeTab.path })
      .then((results) => {
        if (stale) return;
        setBacklinks(results);
      })
      .catch(() => {
        if (stale) return;
        setBacklinks([]);
      });
    return () => {
      stale = true;
    };
  }, [activeTabId]);

  // Check bookmark state
  useEffect(() => {
    if (!activeTab?.path) {
      setIsBookmarked(false);
      return;
    }

    invoke<boolean>("is_file_bookmarked", { path: activeTab.path })
      .then((result) => setIsBookmarked(result))
      .catch(() => setIsBookmarked(false));
  }, [activeTabId]);

  const handleBacklinkClick = async (record: BacklinkRecord) => {
    const name = record.source_title
      || record.source_path.split("/").pop()
      || record.source_path;
    try {
      await openFileInEditor(record.source_path, name);
    } catch (err) {
      console.error("Failed to open backlink source:", err);
    }
  };

  const handleToggleBookmark = async () => {
    if (!activeTab?.path) return;
    try {
      const nowBookmarked = await invoke<boolean>("toggle_bookmark", {
        path: activeTab.path,
      });
      setIsBookmarked(nowBookmarked);
      useAppStore.getState().bumpBookmarkVersion();
    } catch (err) {
      console.error("toggle_bookmark not yet available:", err);
    }
  };

  return (
    <div className={`context-panel ${visible ? "" : "collapsed"}`}>
      {/* Bookmark toggle button */}
      {activeTab && (
        <div className="context-panel-bookmark-row">
          <button
            className={`context-panel-bookmark-btn ${isBookmarked ? "active" : ""}`}
            title={isBookmarked ? "Remove bookmark" : "Bookmark this note"}
            onClick={handleToggleBookmark}
          >
            {isBookmarked ? "★" : "☆"}
          </button>
          <span className="context-panel-bookmark-label">
            {isBookmarked ? "Bookmarked" : "Bookmark"}
          </span>
        </div>
      )}

      {/* Properties section */}
      {activeTab?.path && (
        <PropertiesSection
          path={activeTab.path}
          expanded={propsExpanded}
          onToggle={() => setPropsExpanded((v) => !v)}
          onTypeDetected={handleTypeDetected}
        />
      )}

      {/* Backlinks section */}
      <div className="context-panel-section">
        <div
          className="context-panel-section-title collapsible"
          onClick={() => setBacklinksExpanded((v) => !v)}
        >
          <span className="collapse-arrow">{backlinksExpanded ? "▾" : "▸"}</span>
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
                    onClick={() => handleBacklinkClick(record)}
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

      {/* Outline — placeholder */}
      <div className="context-panel-section">
        <div className="context-panel-section-title">Outline</div>
        <p style={{ color: "var(--text-tertiary)", fontSize: "12px", margin: 0 }}>
          Coming soon.
        </p>
      </div>
    </div>
  );
}
