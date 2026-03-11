import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../stores/app";

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
}

interface RegisteredDirectory {
  id: string;
  path: string;
  label: string;
  color: string;
  position: number;
}

interface TreeNodeProps {
  entry: DirEntry;
  depth: number;
  activeFilePath: string | null;
  onFileClick: (path: string, name: string) => void;
}

function TreeNode({ entry, depth, activeFilePath, onFileClick }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const toggle = async () => {
    if (!entry.is_dir) {
      onFileClick(entry.path, entry.name);
      return;
    }

    if (!loaded) {
      try {
        const entries = await invoke<DirEntry[]>("list_directory", {
          path: entry.path,
        });
        setChildren(entries);
        setLoaded(true);
      } catch (err) {
        console.error("Failed to list directory:", err);
      }
    }
    setExpanded(!expanded);
  };

  const isActive = entry.path === activeFilePath;
  const isMarkdown = entry.extension === "md";

  return (
    <div className={entry.is_dir ? "tree-directory" : "tree-file"}>
      <div
        className={`tree-item ${isActive ? "active" : ""}`}
        style={{ "--indent": depth } as React.CSSProperties}
        onClick={toggle}
      >
        <span className="tree-item-icon">
          {entry.is_dir ? (expanded ? "▾" : "▸") : isMarkdown ? "◇" : "·"}
        </span>
        <span className="tree-item-label">{entry.name}</span>
      </div>
      {entry.is_dir && expanded && (
        <div className="tree-children">
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              onFileClick={onFileClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const openFile = useAppStore((s) => s.openFile);
  const [directories, setDirectories] = useState<RegisteredDirectory[]>([]);
  const [rootEntries, setRootEntries] = useState<Map<string, DirEntry[]>>(
    new Map()
  );

  const loadDirectories = useCallback(async () => {
    try {
      const dirs = await invoke<RegisteredDirectory[]>(
        "get_registered_directories"
      );
      setDirectories(dirs);

      const entries = new Map<string, DirEntry[]>();
      for (const dir of dirs) {
        try {
          const dirEntries = await invoke<DirEntry[]>("list_directory", {
            path: dir.path,
          });
          entries.set(dir.id, dirEntries);
        } catch (err) {
          console.error(`Failed to list ${dir.path}:`, err);
          entries.set(dir.id, []);
        }
      }
      setRootEntries(entries);
    } catch (err) {
      console.error("Failed to load directories:", err);
    }
  }, []);

  useEffect(() => {
    loadDirectories();
  }, [loadDirectories]);

  // Listen for file system changes to refresh
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const unlisten = listen("fs:change", () => {
      clearTimeout(timeout);
      timeout = setTimeout(loadDirectories, 1000);
    });

    return () => {
      clearTimeout(timeout);
      unlisten.then((fn) => fn());
    };
  }, [loadDirectories]);

  const handleFileClick = async (path: string, name: string) => {
    if (!name.endsWith(".md")) return;

    try {
      const content = await invoke<string>("read_file", { path });
      openFile(path, name, content);
    } catch (err) {
      console.error("Failed to read file:", err);
    }
  };

  return (
    <div className={`sidebar ${sidebarVisible ? "" : "collapsed"}`}>
      {directories.length === 0 ? (
        <div className="sidebar-empty">
          <p
            style={{
              padding: "16px 12px",
              color: "var(--text-tertiary)",
              fontSize: "12px",
              lineHeight: "1.5",
            }}
          >
            No directories registered.
            <br />
            Use the command palette or drag a folder here.
          </p>
        </div>
      ) : (
        directories.map((dir) => (
          <div key={dir.id} className="sidebar-directory">
            <div
              className="sidebar-header"
              style={{ borderLeft: `2px solid ${dir.color}` }}
            >
              {dir.label}
            </div>
            <div className="sidebar-content">
              {(rootEntries.get(dir.id) || []).map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  activeFilePath={activeTabId}
                  onFileClick={handleFileClick}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
