const MAX_RECENT = 20;
const STORAGE_KEY = "onyx-recent-docs";

interface RecentDoc {
  path: string;
  name: string;
}

let recentDocs: RecentDoc[] = [];
let listeners: (() => void)[] = [];

// Load from localStorage on module init
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) recentDocs = JSON.parse(raw);
} catch {
  // ignore
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recentDocs));
  } catch {
    // localStorage full — best effort
  }
  for (const fn of listeners) fn();
}

export function recordRecentDoc(path: string, name: string): void {
  // Remove existing entry (dedup)
  recentDocs = recentDocs.filter((d) => d.path !== path);
  // Prepend
  recentDocs.unshift({ path, name });
  // Trim
  if (recentDocs.length > MAX_RECENT) {
    recentDocs = recentDocs.slice(0, MAX_RECENT);
  }
  persist();
}

export function getRecentDocs(): RecentDoc[] {
  return [...recentDocs];
}

export function subscribeRecentDocs(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

/** Update a path in the recent docs list (after rename) */
export function updateRecentDocPath(oldPath: string, newPath: string, newName: string): void {
  const idx = recentDocs.findIndex((d) => d.path === oldPath);
  if (idx !== -1) {
    recentDocs[idx] = { path: newPath, name: newName };
    persist();
  }
}

/** Mark a recent doc as deleted (remove it from the list) */
export function markRecentDocDeleted(path: string): void {
  const before = recentDocs.length;
  recentDocs = recentDocs.filter((d) => d.path !== path);
  if (recentDocs.length !== before) {
    persist();
  }
}
