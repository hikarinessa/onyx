import { useAppStore } from "../stores/app";
import { openFileInEditor } from "./openFile";

const SESSION_KEY = "onyx-session";
const SAVE_INTERVAL_MS = 30_000;

interface SessionData {
  tabs: { path: string; name: string }[];
  activeTabPath: string | null;
  sidebarVisible: boolean;
  contextPanelVisible: boolean;
}

/** Serialize current app state to localStorage */
export function saveSession(): void {
  const state = useAppStore.getState();
  const data: SessionData = {
    tabs: state.tabs.map((t) => ({ path: t.path, name: t.name })),
    activeTabPath: state.activeTabId,
    sidebarVisible: state.sidebarVisible,
    contextPanelVisible: state.contextPanelVisible,
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("Failed to save session:", err);
  }
}

/** Restore session from localStorage — opens tabs in order */
export async function restoreSession(): Promise<void> {
  let data: SessionData;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    data = JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse session:", err);
    return;
  }

  // Restore panel visibility
  const state = useAppStore.getState();
  if (data.sidebarVisible !== state.sidebarVisible) {
    state.toggleSidebar();
  }
  if (data.contextPanelVisible !== state.contextPanelVisible) {
    state.toggleContextPanel();
  }

  // Open tabs in order
  for (const tab of data.tabs) {
    try {
      await openFileInEditor(tab.path, tab.name);
    } catch (err) {
      console.error(`Failed to restore tab ${tab.path}:`, err);
    }
  }

  // Switch to the previously active tab
  if (data.activeTabPath) {
    const existing = useAppStore.getState().tabs.find(
      (t) => t.path === data.activeTabPath
    );
    if (existing) {
      useAppStore.getState().setActiveTab(existing.id);
    }
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

/** Start periodic session saving + beforeunload handler */
export function initSessionPersistence(): () => void {
  // Save periodically
  intervalId = setInterval(saveSession, SAVE_INTERVAL_MS);

  // Save on unload
  const handleBeforeUnload = () => saveSession();
  window.addEventListener("beforeunload", handleBeforeUnload);

  // Return cleanup function
  return () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}
