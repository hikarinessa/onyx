import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type AccordionState, type EditorMode } from "../stores/app";
import { openFileInEditor } from "./openFile";
import { getActiveThemeId, applyTheme } from "./themes";

const SAVE_INTERVAL_MS = 30_000;
const SESSION_BACKUP_KEY = "onyx-session-backup";
/** Legacy key from pre-4.6 localStorage-only sessions */
const SESSION_LEGACY_KEY = "onyx-session";

interface SessionPaneData {
  tabs: { path: string; name: string; editorMode?: EditorMode }[];
  activeTabPath: string | null;
}

interface SessionData {
  // Legacy flat format (pre-split-panes)
  tabs?: { path: string; name: string; editorMode?: EditorMode }[];
  activeTabPath?: string | null;
  // New pane-aware format
  panes?: SessionPaneData[];
  activePaneIndex?: number;
  splitRatios?: number[];
  // Shared state
  sidebarVisible: boolean;
  contextPanelVisible: boolean;
  collapsedDirs?: string[];
  expandedSubdirs?: string[];
  themeId?: string;
  accordionState?: AccordionState;
  orphanPaths?: string[];
  orphanIcon?: string;
  timestamp: number;
}

function getSessionData(): SessionData {
  const state = useAppStore.getState();
  const { paneState } = state;

  return {
    panes: paneState.panes.map((p) => ({
      tabs: p.tabs.map((t) => ({ path: t.path, name: t.name, editorMode: t.editorMode })),
      activeTabPath: p.activeTabId,
    })),
    activePaneIndex: paneState.panes.findIndex((p) => p.id === paneState.activePaneId),
    splitRatios: paneState.splitRatios,
    sidebarVisible: state.sidebarVisible,
    contextPanelVisible: state.contextPanelVisible,
    collapsedDirs: state.collapsedDirs,
    expandedSubdirs: state.expandedSubdirs,
    themeId: getActiveThemeId(),
    accordionState: state.accordionState,
    orphanPaths: state.orphanPaths,
    orphanIcon: state.orphanIcon,
    timestamp: Date.now(),
  };
}

/** Save session to ~/.onyx/session.json via Rust (async, reliable) */
export function saveSession(): void {
  const json = JSON.stringify(getSessionData());
  invoke("write_session", { json }).catch((err) =>
    console.error("Failed to save session:", err)
  );
}

/**
 * Synchronous backup to localStorage for beforeunload.
 * The async Rust IPC may not complete before the process exits,
 * so we write a synchronous backup. On restore, the newest wins.
 */
function saveSessionSync(): void {
  try {
    localStorage.setItem(SESSION_BACKUP_KEY, JSON.stringify(getSessionData()));
  } catch {
    // localStorage full or unavailable — best effort
  }
}

/** Export for ErrorBoundary to trigger a sync save before reload */
export function saveSessionBeforeReload(): void {
  saveSessionSync();
}

function parseSession(raw: string): SessionData | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Restore session — picks the newest between file and localStorage backup */
export async function restoreSession(): Promise<void> {
  let fileData: SessionData | null = null;
  let backupData: SessionData | null = null;

  try {
    const raw = await invoke<string | null>("read_session");
    if (raw) fileData = parseSession(raw);
  } catch (err) {
    console.error("Failed to read session file:", err);
  }

  // Try localStorage backup (current key, then legacy key from pre-4.6)
  const backupRaw = localStorage.getItem(SESSION_BACKUP_KEY)
    || localStorage.getItem(SESSION_LEGACY_KEY);
  if (backupRaw) backupData = parseSession(backupRaw);

  // Pick the newest (timestamp field; data without timestamp treated as 0)
  const fileTs = fileData?.timestamp ?? 0;
  const backupTs = backupData?.timestamp ?? 0;
  const data = fileTs >= backupTs ? fileData : backupData;

  if (!data) return;

  // Clean up legacy key after successful migration
  localStorage.removeItem(SESSION_LEGACY_KEY);

  // Restore theme (authoritative source — overrides localStorage fast-path)
  if (data.themeId) {
    applyTheme(data.themeId);
  }

  // Restore panel visibility
  const state = useAppStore.getState();
  if (data.sidebarVisible !== state.sidebarVisible) {
    state.toggleSidebar();
  }
  if (data.contextPanelVisible !== state.contextPanelVisible) {
    state.toggleContextPanel();
  }

  // Restore collapsed directories
  if (data.collapsedDirs && data.collapsedDirs.length > 0) {
    for (const dirId of data.collapsedDirs) {
      state.toggleDirCollapsed(dirId);
    }
  }

  // Restore expanded subdirectories
  if (data.expandedSubdirs && data.expandedSubdirs.length > 0) {
    for (const path of data.expandedSubdirs) {
      state.toggleSubdirExpanded(path);
    }
  }

  // Restore accordion state
  if (data.accordionState) {
    for (const [key, val] of Object.entries(data.accordionState)) {
      state.setAccordionExpanded(key as keyof AccordionState, val);
    }
  }

  // Restore orphan icon
  if (data.orphanIcon) {
    state.setOrphanIcon(data.orphanIcon);
  }

  // Restore orphan paths — allow in Rust, validate existence, remove dead ones
  if (data.orphanPaths && data.orphanPaths.length > 0) {
    for (const p of data.orphanPaths) {
      try {
        await invoke("allow_path", { path: p });
        const exists = await invoke<boolean>("path_exists", { path: p });
        if (exists) {
          state.addOrphanPath(p);
        } else {
          await invoke("disallow_path", { path: p });
        }
      } catch {
        // File gone or inaccessible — skip silently
      }
    }
  }

  // Determine pane layout to restore
  const paneDatas: SessionPaneData[] = data.panes
    ? data.panes
    : data.tabs
      ? [{ tabs: data.tabs, activeTabPath: data.activeTabPath ?? null }]
      : [];

  if (paneDatas.length === 0) return;

  // Create additional panes if needed (pane-0 already exists)
  for (let i = 1; i < paneDatas.length; i++) {
    useAppStore.getState().splitPane();
  }

  // Restore split ratios
  if (data.splitRatios && data.splitRatios.length > 0) {
    useAppStore.getState().setSplitRatios(data.splitRatios);
  }

  // Open tabs in each pane
  for (let i = 0; i < paneDatas.length; i++) {
    const paneData = paneDatas[i];
    const paneId = useAppStore.getState().paneState.panes[i]?.id;
    if (!paneId) continue;

    // Set this pane as active so openFileInEditor targets it
    useAppStore.getState().setActivePane(paneId);

    // Validate file existence before opening — skip dead entries
    for (const tab of paneData.tabs) {
      try {
        const exists = await invoke<boolean>("path_exists", { path: tab.path });
        if (exists) {
          await openFileInEditor(tab.path, tab.name);
        } else {
          console.warn(`Session restore: skipping deleted file ${tab.path}`);
        }
      } catch (err) {
        console.error(`Failed to restore tab ${tab.path}:`, err);
      }
    }

    // Restore per-tab editor mode
    const store = useAppStore.getState();
    const pane = store.paneState.panes.find((p) => p.id === paneId);
    if (pane) {
      for (const tab of paneData.tabs) {
        if (tab.editorMode === "source") {
          const existing = pane.tabs.find((t) => t.path === tab.path);
          if (existing) store.toggleEditorMode(existing.id);
        }
      }
    }

    // Switch to the previously active tab in this pane
    if (paneData.activeTabPath) {
      const existing = useAppStore.getState().paneState.panes
        .find((p) => p.id === paneId)?.tabs
        .find((t) => t.path === paneData.activeTabPath);
      if (existing) {
        useAppStore.getState().setActiveTab(existing.id);
      }
    }
  }

  // Restore active pane
  const activePaneIdx = data.activePaneIndex ?? 0;
  const targetPaneId = useAppStore.getState().paneState.panes[activePaneIdx]?.id;
  if (targetPaneId) {
    useAppStore.getState().setActivePane(targetPaneId);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

/** Start periodic session saving + beforeunload handler */
export function initSessionPersistence(): () => void {
  // Save periodically (async, reliable)
  intervalId = setInterval(saveSession, SAVE_INTERVAL_MS);

  // Save on unload (sync backup — async IPC may not complete before exit)
  const handleBeforeUnload = () => {
    saveSession();     // best-effort async
    saveSessionSync(); // guaranteed sync backup
  };
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
