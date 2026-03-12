import { useState, useEffect, useRef } from "react";
import type { DirEntry } from "../types";

export type { DirEntry };

export interface ContextMenuState {
  x: number;
  y: number;
  entry: DirEntry;
}

export function SidebarContextMenu({
  menu,
  onClose,
  onNewNote,
  onNewFolder,
  onRename,
  onDelete,
  onReveal,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onNewNote: (entry: DirEntry) => void;
  onNewFolder: (entry: DirEntry) => void;
  onRename: (entry: DirEntry) => void;
  onDelete: (entry: DirEntry) => void;
  onReveal: (entry: DirEntry) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Clamp to viewport after the menu renders and we know its dimensions
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    const x = Math.min(menu.x, window.innerWidth - rect.width - pad);
    const y = Math.min(menu.y, window.innerHeight - rect.height - pad);
    setPosition({ x, y });
  }, [menu.x, menu.y]);

  const isDir = menu.entry.is_dir;

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="context-menu-item"
        onClick={() => {
          onNewNote(menu.entry);
          onClose();
        }}
      >
        {isDir ? "New Note" : "New Note (sibling)"}
      </div>
      {isDir && (
        <div
          className="context-menu-item"
          onClick={() => {
            onNewFolder(menu.entry);
            onClose();
          }}
        >
          New Folder
        </div>
      )}
      <div className="context-menu-separator" />
      <div
        className="context-menu-item"
        onClick={() => {
          onRename(menu.entry);
          onClose();
        }}
      >
        Rename
      </div>
      <div
        className="context-menu-item"
        onClick={() => {
          onReveal(menu.entry);
          onClose();
        }}
      >
        Reveal in Finder
      </div>
      <div className="context-menu-separator" />
      <div
        className="context-menu-item destructive"
        onClick={() => {
          onDelete(menu.entry);
          onClose();
        }}
      >
        Delete
      </div>
    </div>
  );
}
