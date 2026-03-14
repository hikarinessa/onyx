import { useState, useRef } from "react";
import { useAppStore, selectActivePane } from "../stores/app";
import { Icon } from "./Icon";

export function TabBar({ paneId }: { paneId?: string }) {
  // Get the specific pane's tabs, or fall back to active pane
  const pane = useAppStore((s) => {
    const id = paneId || s.paneState.activePaneId;
    return s.paneState.panes.find((p) => p.id === id) || selectActivePane(s);
  });
  const activePaneId = useAppStore((s) => s.paneState.activePaneId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);
  const setActivePane = useAppStore((s) => s.setActivePane);

  const tabs = pane.tabs;
  const activeTabId = pane.activeTabId;
  const isActivePane = pane.id === activePaneId;

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragStartRef = useRef<number | null>(null);

  if (tabs.length === 0) return null;

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
    if (fromIndex !== null && fromIndex !== toIndex) {
      reorderTabs(fromIndex, toIndex, pane.id);
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
    <div
      className={`tabbar ${isActivePane ? "" : "tabbar-inactive"}`}
      onPointerDown={() => { if (!isActivePane) setActivePane(pane.id); }}
    >
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? "active" : ""} ${
            dragIndex === i ? "dragging" : ""
          } ${dropIndex === i && dragIndex !== i ? "drop-target" : ""}`}
          draggable
          onClick={() => {
            if (!isActivePane) setActivePane(pane.id);
            setActiveTab(tab.id);
          }}
          onDragStart={(e) => handleDragStart(e, i)}
          onDragOver={(e) => handleDragOver(e, i)}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={handleDragEnd}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              closeTab(tab.id);
            }
          }}
        >
          {tab.modified && <span className="tab-modified" />}
          <span className="tab-label">{tab.name}</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
