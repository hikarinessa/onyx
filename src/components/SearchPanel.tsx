import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openFileInEditor } from "../lib/openFile";
import { getEditorView } from "./Editor";
import { EditorSelection } from "@codemirror/state";
import { Icon } from "./Icon";

interface LineMatch {
  line_number: number;
  line_text: string;
}

interface ContentSearchResult {
  path: string;
  title: string;
  match_count: number;
  title_match: boolean;
  line_matches: LineMatch[];
}

export function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await invoke<ContentSearchResult[]>("search_content", { query: q });
      setResults(res);
      // Auto-expand first 5 results
      const autoExpand = new Set(res.slice(0, 5).map((r) => r.path));
      setExpandedFiles(autoExpand);
    } catch (err) {
      console.error("search_content failed:", err);
      setResults([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, doSearch]);

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openAtLine = async (path: string, lineNumber: number) => {
    const name = path.split("/").pop() || path;
    await openFileInEditor(path, name, { replaceActive: true });
    // Position cursor after editor swaps state
    requestAnimationFrame(() => {
      const view = getEditorView();
      if (!view) return;
      const ln = Math.min(lineNumber, view.state.doc.lines);
      const line = view.state.doc.line(ln);
      view.dispatch({
        selection: EditorSelection.cursor(line.from),
        scrollIntoView: true,
      });
      view.focus();
    });
  };

  const highlightMatch = (text: string, q: string) => {
    if (!q.trim()) return text;
    const lower = text.toLowerCase();
    const qLower = q.toLowerCase();
    const idx = lower.indexOf(qLower);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="search-highlight">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  const titleMatches = results.filter((r) => r.title_match);
  const contentMatches = results.filter((r) => !r.title_match);
  const totalCount = results.length;

  return (
    <div className="search-panel">
      <div className="search-panel-input-wrap">
        <Icon name="search" size={13} />
        <input
          ref={inputRef}
          className="search-panel-input"
          type="text"
          placeholder="Search in files..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="search-clear-btn" onClick={() => setQuery("")}>
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      <div className="search-panel-results">
        {loading && query.trim() && (
          <div className="search-status">Searching...</div>
        )}

        {!loading && query.trim() && totalCount === 0 && (
          <div className="search-status">No matches found</div>
        )}

        {!loading && !query.trim() && (
          <div className="search-status">Type to search across all files</div>
        )}

        {!loading && totalCount > 0 && (
          <div className="search-count">{totalCount} file{totalCount !== 1 ? "s" : ""}</div>
        )}

        {titleMatches.length > 0 && (
          <div className="search-section">
            <div className="search-section-header">Title Matches</div>
            {titleMatches.map((r) => (
              <FileResult
                key={r.path}
                result={r}
                query={query}
                expanded={expandedFiles.has(r.path)}
                onToggle={() => toggleFile(r.path)}
                onLineClick={openAtLine}
                highlightMatch={highlightMatch}
              />
            ))}
          </div>
        )}

        {contentMatches.length > 0 && (
          <div className="search-section">
            {titleMatches.length > 0 && (
              <div className="search-section-header">Content Matches</div>
            )}
            {contentMatches.map((r) => (
              <FileResult
                key={r.path}
                result={r}
                query={query}
                expanded={expandedFiles.has(r.path)}
                onToggle={() => toggleFile(r.path)}
                onLineClick={openAtLine}
                highlightMatch={highlightMatch}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FileResult({
  result,
  query,
  expanded,
  onToggle,
  onLineClick,
  highlightMatch,
}: {
  result: ContentSearchResult;
  query: string;
  expanded: boolean;
  onToggle: () => void;
  onLineClick: (path: string, line: number) => void;
  highlightMatch: (text: string, q: string) => React.ReactNode;
}) {
  const hasLineMatches = result.line_matches.length > 0;

  const handleHeaderClick = () => {
    if (hasLineMatches) {
      onToggle();
    } else {
      onLineClick(result.path, 1);
    }
  };

  return (
    <div className="search-file-group">
      <div className="search-file-header" onClick={handleHeaderClick}>
        {hasLineMatches ? (
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} />
        ) : (
          <span style={{ width: 12 }} />
        )}
        <Icon name="file-text" size={13} />
        <span className="search-file-name">{highlightMatch(result.title, query)}</span>
        {result.match_count > 0 && (
          <span className="search-match-count">{result.match_count}</span>
        )}
      </div>
      {expanded && result.line_matches.length > 0 && (
        <div className="search-line-matches">
          {result.line_matches.map((lm) => (
            <div
              key={lm.line_number}
              className="search-line-match"
              onClick={() => onLineClick(result.path, lm.line_number)}
            >
              <span className="search-line-number">{lm.line_number}</span>
              <span className="search-line-text">
                {highlightMatch(lm.line_text, query)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
