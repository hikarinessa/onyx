import { useState, useRef } from "react";
import { useAppStore, type PaneId } from "../stores/app";

interface TabBarProps {
  /** If set, render in per-pane mode with only these tab IDs */
  paneId?: PaneId;
  tabIds?: string[];
  activeTabId?: string | null;
  onActivate?: (tabId: string) => void;
  onClose?: (tabId: string) => void;
  hidden?: boolean;
}

export function TabBar(props: TabBarProps) {
  const allTabs = useAppStore((s) => s.tabs);
  const globalActiveTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);

  const isPaneMode = props.paneId !== undefined;
  const displayTabs = isPaneMode
    ? allTabs.filter((t) => props.tabIds?.includes(t.id))
    : allTabs;
  const currentActiveId = isPaneMode ? props.activeTabId : globalActiveTabId;
  const handleActivate = isPaneMode
    ? (id: string) => props.onActivate?.(id)
    : (id: string) => setActiveTab(id);
  const handleClose = isPaneMode
    ? (id: string) => props.onClose?.(id)
    : (id: string) => closeTab(id);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragStartRef = useRef<number | null>(null);

  if (props.hidden || displayTabs.length === 0) return null;

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragStartRef.current = index;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(index);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = dragStartRef.current;
    if (fromIndex !== null && fromIndex !== toIndex && !isPaneMode) {
      reorderTabs(fromIndex, toIndex);
    }
    setDragIndex(null);
    setDropIndex(null);
    dragStartRef.current = null;
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
    dragStartRef.current = null;
  };

  return (
    <div className={`tabbar ${isPaneMode ? "tabbar-pane" : ""}`}>
      {displayTabs.map((tab, i) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === currentActiveId ? "active" : ""} ${
            dragIndex === i ? "dragging" : ""
          } ${dropIndex === i && dragIndex !== i ? "drop-target" : ""}`}
          draggable={!isPaneMode}
          onClick={() => handleActivate(tab.id)}
          onDragStart={(e) => handleDragStart(e, i)}
          onDragOver={(e) => handleDragOver(e, i)}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={handleDragEnd}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              handleClose(tab.id);
            }
          }}
        >
          {tab.modified && <span className="tab-modified" />}
          <span className="tab-label">{tab.name}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              handleClose(tab.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
