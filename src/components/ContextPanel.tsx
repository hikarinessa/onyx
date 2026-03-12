import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type AccordionState } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";
import { replaceTabContent, scrollToLine } from "../lib/editorBridge";
import { editorStateCache } from "./editorShared";
import { Calendar } from "./Calendar";
import { createOrOpenPeriodicNote } from "../lib/periodicNotes";

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
          const activeTabId = useAppStore.getState().activeTabId;
          if (activeTabId) {
            replaceTabContent(activeTabId, content);
          }
        } catch (err) {
          console.error("Failed to update frontmatter:", err);
        }
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
            Object.entries(frontmatter).map(([key, val]) => {
              // Infer widget type from value shape
              const inferredType: PropertyDef["type"] = Array.isArray(val)
                ? "tags"
                : typeof val === "boolean"
                  ? "checkbox"
                  : typeof val === "number"
                    ? "number"
                    : "text";
              return (
                <div key={key} className="prop-row">
                  <div className="prop-label" title={key}>
                    {key}
                  </div>
                  <div className="prop-value">
                    <PropertyField
                      def={{ key, type: inferredType }}
                      value={val}
                      onChange={(v) => handleChange(key, v)}
                    />
                  </div>
                </div>
              );
            })
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
        <span className="collapse-arrow">{expanded ? "▾" : "▸"}</span>
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
                className="backlink-item"
                title={doc.path}
                onClick={async () => {
                  try {
                    await openFileInEditor(doc.path, doc.name);
                  } catch (err) {
                    console.error("Failed to open recent doc:", err);
                  }
                }}
              >
                <div className="backlink-title">{doc.name}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Outline Section ──

interface HeadingEntry {
  level: number;
  text: string;
  lineNumber: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

function OutlineSection({
  path,
  expanded,
  onToggle,
  saveVersion,
}: {
  path: string;
  expanded: boolean;
  onToggle: () => void;
  saveVersion: number;
}) {
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);

  useEffect(() => {
    // Read from editor state cache (in-memory) instead of disk IPC
    const cachedState = editorStateCache.get(path);
    const content = cachedState ? cachedState.doc.toString() : null;
    if (!content) {
      setHeadings([]);
      return;
    }

    const entries: HeadingEntry[] = [];
    const lines = content.split("\n");
    let inFrontmatter = false;
    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === 0 && line.trim() === "---") {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter) {
        if (line.trim() === "---") inFrontmatter = false;
        continue;
      }
      if (line.trimStart().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;
      const match = line.match(HEADING_RE);
      if (match) {
        entries.push({
          level: match[1].length,
          text: match[2].trim(),
          lineNumber: i + 1,
        });
      }
    }
    setHeadings(entries);
  }, [path, saveVersion]);

  return (
    <div className="context-panel-section">
      <div
        className="context-panel-section-title collapsible"
        onClick={onToggle}
      >
        <span className="collapse-arrow">{expanded ? "▾" : "▸"}</span>
        Outline ({headings.length})
      </div>
      {expanded && (
        <div className="outline-list">
          {headings.length === 0 ? (
            <div className="backlinks-empty">No headings</div>
          ) : (
            headings.map((h, i) => (
              <button
                key={`${h.lineNumber}-${i}`}
                className="outline-item"
                style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                onClick={() => scrollToLine(h.lineNumber)}
              >
                {h.text}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──

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

export function ContextPanel() {
  const visible = useAppStore((s) => s.contextPanelVisible);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const saveVersion = useAppStore((s) => s.saveVersion);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [hasType, setHasType] = useState(false);

  // Accordion sections with store persistence
  const [propsExpanded, toggleProps] = useAccordionSection("properties", hasType);
  const [backlinksExpanded, toggleBacklinks] = useAccordionSection("backlinks", !hasType);
  const [outlineExpanded, toggleOutline] = useAccordionSection("outline", true);
  const [recentExpanded, toggleRecent] = useAccordionSection("recent", false);

  // Smart defaults: reset overrides on tab switch so defaults re-apply
  const handleTypeDetected = useCallback((detected: boolean) => {
    setHasType(detected);
  }, []);

  // Fetch backlinks
  useEffect(() => {
    if (!activeTab?.path) {
      setBacklinks([]);
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

  // Check bookmark state (directory bookmark OR global bookmark)
  useEffect(() => {
    if (!activeTab?.path) {
      setIsBookmarked(false);
      return;
    }

    Promise.all([
      invoke<boolean>("is_file_bookmarked", { path: activeTab.path }).catch(() => false),
      invoke<boolean>("is_global_bookmarked", { path: activeTab.path }).catch(() => false),
    ]).then(([dir, global]) => setIsBookmarked(dir || global));
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
      // Try directory bookmark first (file is indexed)
      const nowBookmarked = await invoke<boolean>("toggle_bookmark", {
        path: activeTab.path,
      });
      setIsBookmarked(nowBookmarked);
      useAppStore.getState().bumpBookmarkVersion();
    } catch {
      // File not in a registered directory — use global bookmark
      try {
        const label = activeTab.name || activeTab.path.split("/").pop() || activeTab.path;
        const nowBookmarked = await invoke<boolean>("toggle_global_bookmark", {
          path: activeTab.path,
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
  const creatingRef = useRef(false);

  const handleDateClick = async (isoDate: string) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCalendarError(null);
    try {
      await createOrOpenPeriodicNote("daily", isoDate);
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

  return (
    <div className={`context-panel ${visible ? "" : "collapsed"}`}>
      {/* Calendar */}
      <Calendar onDateClick={handleDateClick} />
      {calendarError && (
        <div className="calendar-error">{calendarError}</div>
      )}

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
          onToggle={toggleProps}
          onTypeDetected={handleTypeDetected}
          saveVersion={saveVersion}
        />
      )}

      {/* Outline section */}
      {activeTab?.path && (
        <OutlineSection
          path={activeTab.path}
          expanded={outlineExpanded}
          onToggle={toggleOutline}
          saveVersion={saveVersion}
        />
      )}

      {/* Backlinks section */}
      <div className="context-panel-section">
        <div
          className="context-panel-section-title collapsible"
          onClick={toggleBacklinks}
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

      {/* Recent Documents */}
      <RecentDocuments expanded={recentExpanded} onToggle={toggleRecent} />
    </div>
  );
}
