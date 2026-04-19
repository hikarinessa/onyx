import { useState, useRef, useEffect, useCallback } from "react";
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

  const deletedPaths = useAppStore((s) => s.deletedPaths);

  const tabs = pane.tabs;
  const activeTabId = pane.activeTabId;
  const isActivePane = pane.id === activePaneId;

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragStartRef = useRef<number | null>(null);

  // Overflow detection
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setHasOverflow(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkOverflow();
    el.addEventListener("scroll", checkOverflow);
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", checkOverflow);
      ro.disconnect();
    };
  }, [checkOverflow, tabs.length]);

  // Scroll the active tab into view when it changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeTabId) return;
    const activeEl = el.querySelector('.tab.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest", inline: "nearest" });
      requestAnimationFrame(checkOverflow);
    }
  }, [activeTabId, checkOverflow]);

  // Close menu on click outside or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

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

  const closeAllTabs = () => {
    const ids = tabs.map((t) => t.id);
    for (const id of ids) closeTab(id);
    setMenuOpen(false);
  };

  return (
    <div
      className={`tabbar ${isActivePane ? "" : "tabbar-inactive"}`}
      onPointerDown={() => { if (!isActivePane) setActivePane(pane.id); }}
    >
      <div className="tabbar-scroll" ref={scrollRef}>
        {tabs.map((tab, i) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? "active" : ""} ${
              dragIndex === i ? "dragging" : ""
            } ${dropIndex === i && dragIndex !== i ? "drop-target" : ""} ${
              deletedPaths.has(tab.path) ? "tab-deleted" : ""
            }`}
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
      {hasOverflow && (
        <div className="tabbar-overflow" ref={menuRef}>
          <button
            className={`tabbar-overflow-btn ${menuOpen ? "active" : ""}`}
            onClick={() => setMenuOpen(!menuOpen)}
            tabIndex={-1}
            title="All tabs"
          >
            <Icon name="chevron-down" size={14} />
          </button>
          {menuOpen && (
            <div className="tabbar-overflow-menu">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`tabbar-overflow-item ${tab.id === activeTabId ? "active" : ""}`}
                  onClick={() => {
                    if (!isActivePane) setActivePane(pane.id);
                    setActiveTab(tab.id);
                    setMenuOpen(false);
                    // Scroll the tab into view
                    requestAnimationFrame(() => {
                      const el = scrollRef.current?.querySelector('.tab.active');
                      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
                    });
                  }}
                >
                  <span className="tabbar-overflow-item-label">{tab.name}</span>
                  <button
                    className="tabbar-overflow-item-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </button>
              ))}
              <div className="tabbar-overflow-divider" />
              <button className="tabbar-overflow-item tabbar-overflow-close-all" onClick={closeAllTabs}>
                Close all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
