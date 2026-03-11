import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openFileInEditor } from "../lib/openFile";

interface FileRecord {
  id: number;
  path: string;
  dir_id: string;
  title: string | null;
  modified_at: number | null;
  frontmatter: string | null;
}

interface SearchResult {
  name: string;
  path: string;
}

interface QuickOpenProps {
  visible: boolean;
  onClose: () => void;
}

export function QuickOpen({ visible, onClose }: QuickOpenProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (visible) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      // Small delay to ensure the element is rendered
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  // Search when query changes
  useEffect(() => {
    if (!visible || query.trim() === "") {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    let cancelled = false;

    const doSearch = async () => {
      try {
        const hits = await invoke<FileRecord[]>("search_files", {
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
      } catch {
        // Command doesn't exist yet — no fallback available without file tree data
        if (!cancelled) {
          setResults([]);
          setSelectedIndex(0);
        }
      }
    };

    doSearch();
    return () => {
      cancelled = true;
    };
  }, [query, visible]);

  const selectResult = useCallback(
    (result: SearchResult) => {
      onClose();
      openFileInEditor(result.path, result.name);
    },
    [onClose]
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
          selectResult(results[selectedIndex]);
        }
        return;
      }
    },
    [results, selectedIndex, selectResult, onClose]
  );

  if (!visible) return null;

  // Extract relative path (everything after the filename)
  const getRelativePath = (fullPath: string, name: string): string => {
    const dir = fullPath.slice(0, fullPath.length - name.length);
    // Trim trailing slash and show last few segments
    const parts = dir.replace(/\/$/, "").split("/");
    return parts.slice(-3).join("/");
  };

  return (
    <div className="quick-open-overlay" onClick={onClose}>
      <div className="quick-open" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="quick-open-input"
          type="text"
          placeholder="Open a file..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="quick-open-results">
          {results.map((result, i) => (
            <div
              key={result.path}
              className={`quick-open-item ${i === selectedIndex ? "selected" : ""}`}
              onClick={() => selectResult(result)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="quick-open-item-name">{result.name}</span>
              <span className="quick-open-item-path">
                {getRelativePath(result.path, result.name)}
              </span>
            </div>
          ))}
          {query.trim() !== "" && results.length === 0 && (
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
