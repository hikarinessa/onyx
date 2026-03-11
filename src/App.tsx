import { useState, useEffect } from "react";
import { Titlebar } from "./components/Titlebar";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { Editor } from "./components/Editor";
import { ContextPanel } from "./components/ContextPanel";
import { StatusBar } from "./components/StatusBar";
import { QuickOpen } from "./components/QuickOpen";
import { useAppStore } from "./stores/app";

export default function App() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleContextPanel = useAppStore((s) => s.toggleContextPanel);
  const closeTab = useAppStore((s) => s.closeTab);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const alt = e.altKey;

      // Cmd+Option+[ — toggle sidebar
      if (meta && alt && e.key === "[") {
        e.preventDefault();
        toggleSidebar();
      }

      // Cmd+Option+] — toggle context panel
      if (meta && alt && e.key === "]") {
        e.preventDefault();
        toggleContextPanel();
      }

      // Cmd+W — close active tab
      if (meta && e.key === "w") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      }

      // Cmd+O — toggle quick open
      if (meta && !alt && e.key === "o") {
        e.preventDefault();
        setQuickOpenVisible((v) => !v);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar, toggleContextPanel, closeTab, activeTabId]);

  return (
    <div className="app">
      <Titlebar />
      <TabBar />
      <div className="main">
        <Sidebar />
        <Editor />
        <ContextPanel />
      </div>
      <StatusBar />
      <QuickOpen
        visible={quickOpenVisible}
        onClose={() => setQuickOpenVisible(false)}
      />
    </div>
  );
}
