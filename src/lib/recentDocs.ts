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
