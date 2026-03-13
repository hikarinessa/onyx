import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/app";
import { openFileInEditor } from "../lib/openFile";
import { insertAtCursor } from "./Editor";

interface RustSearchResult {
  path: string;
  title: string | null;
}

interface ObjectType {
  name: string;
  properties: unknown[];
}

interface SearchResult {
  name: string;
  path: string;
}

interface TypeSuggestion {
  kind: "type-suggestion";
  name: string;
}

type QuickOpenItem = SearchResult | TypeSuggestion;

function isTypeSuggestion(item: QuickOpenItem): item is TypeSuggestion {
  return "kind" in item && item.kind === "type-suggestion";
}

/** Parse `type:foo` prefix. Returns null if no prefix, or { typeName } (possibly empty). */
function parseTypePrefix(q: string): { typeName: string } | null {
  const trimmed = q.trimStart();
  if (!trimmed.toLowerCase().startsWith("type:")) return null;
  const typeName = trimmed.slice(5).trim();
  return { typeName };
}

export function QuickOpen() {
  const visible = useAppStore((s) => s.quickOpenVisible);
  const mode = useAppStore((s) => s.quickOpenMode);

  const onClose = useCallback(() => {
    useAppStore.getState().setQuickOpenVisible(false);
    useAppStore.getState().setQuickOpenMode("open");
  }, []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickOpenItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (visible) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  // Search when query changes
  useEffect(() => {
    if (!visible) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    const parsed = parseTypePrefix(query);

    // Empty query, no prefix → clear
    if (!parsed && query.trim() === "") {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        if (parsed) {
          if (parsed.typeName === "") {
            // Show available object types as suggestions
            const types = await invoke<ObjectType[]>("get_object_types");
            if (!cancelled) {
              setResults(
                types.map((t) => ({ kind: "type-suggestion" as const, name: t.name }))
              );
              setSelectedIndex(0);
            }
          } else {
            // Query by type
            const hits = await invoke<RustSearchResult[]>("query_by_type", {
              typeName: parsed.typeName,
            });
            if (!cancelled) {
              setResults(
                hits.slice(0, 10).map((f) => ({
                  name: f.title ? f.title + ".md" : f.path.split("/").pop() || f.path,
                  path: f.path,
                }))
              );
              setSelectedIndex(0);
            }
          }
        } else {
          // Normal file search
          const hits = await invoke<RustSearchResult[]>("search_files", {
            query: query.trim(),
          });
          if (!cancelled) {
            setResults(
              hits.slice(0, 10).map((f) => ({
                name: f.title ? f.title + ".md" : f.path.split("/").pop() || f.path,
                path: f.path,
              }))
            );
            setSelectedIndex(0);
          }
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setSelectedIndex(0);
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, visible]);

  const selectItem = useCallback(
    (item: QuickOpenItem, newTab = false) => {
      if (isTypeSuggestion(item)) {
        // Fill in the type: prefix and trigger query
        setQuery(`type:${item.name}`);
        inputRef.current?.focus();
      } else if (mode === "insert-wikilink") {
        const title = item.name.replace(/\.md$/, "");
        insertAtCursor(`[[${title}]]`);
        onClose();
      } else {
        onClose();
        openFileInEditor(item.path, item.name, { replaceActive: !newTab });
      }
    },
    [onClose, mode]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (results[selectedIndex]) {
          selectItem(results[selectedIndex], e.metaKey);
        }
        return;
      }
    },
    [results, selectedIndex, selectItem, onClose]
  );

  if (!visible) return null;

  // Extract relative path (everything after the filename)
  const getRelativePath = (fullPath: string, name: string): string => {
    const dir = fullPath.slice(0, fullPath.length - name.length);
    const parts = dir.replace(/\/$/, "").split("/");
    return parts.slice(-3).join("/");
  };

  const parsed = parseTypePrefix(query);
  const showingTypeSuggestions = parsed !== null && parsed.typeName === "" && results.length > 0;
  const noResults =
    query.trim() !== "" && results.length === 0 && !(parsed && parsed.typeName === "");

  return (
    <div className="quick-open-overlay" onClick={onClose}>
      <div className="quick-open" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="quick-open-input"
          type="text"
          placeholder={mode === "insert-wikilink" ? "Insert link to..." : "Open a file... (type: to filter by type)"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="quick-open-results">
          {showingTypeSuggestions &&
            results.map((item, i) => {
              if (!isTypeSuggestion(item)) return null;
              return (
                <div
                  key={item.name}
                  className={`quick-open-item ${i === selectedIndex ? "selected" : ""}`}
                  onClick={(e) => selectItem(item, e.metaKey)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="quick-open-item-name quick-open-type-hint">
                    {item.name}
                  </span>
                  <span className="quick-open-item-path">Object type</span>
                </div>
              );
            })}
          {!showingTypeSuggestions &&
            results.map((item, i) => {
              if (isTypeSuggestion(item)) return null;
              return (
                <div
                  key={item.path}
                  className={`quick-open-item ${i === selectedIndex ? "selected" : ""}`}
                  onClick={(e) => selectItem(item, e.metaKey)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="quick-open-item-name">{item.name}</span>
                  <span className="quick-open-item-path">
                    {getRelativePath(item.path, item.name)}
                  </span>
                </div>
              );
            })}
          {noResults && (
            <div
              style={{
                padding: "12px 16px",
                fontSize: "13px",
                color: "var(--text-tertiary)",
              }}
            >
              No results found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
