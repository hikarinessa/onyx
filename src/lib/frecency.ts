/**
 * Frecency: rank by how often and how recently something was chosen.
 *
 * score = uses × 0.5^(age / HALF_LIFE), so a use counts half as much a week later, and
 * a score under MIN_SCORE counts as never used: one use fades out after about three
 * weeks rather than outranking better matches forever. Used by the command palette
 * (command ids) and Quick Open (file paths). Kept in localStorage, like recent docs:
 * losing it only loses ordering, never data.
 */

export type FrecencyNamespace = "commands" | "files";

interface Entry {
  uses: number;
  /** ms since epoch of the latest use */
  last: number;
}

const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const MIN_SCORE = 0.1;
const storageKey = (ns: FrecencyNamespace) => `onyx-frecency-${ns}`;

const cache = new Map<FrecencyNamespace, Record<string, Entry>>();

function load(ns: FrecencyNamespace): Record<string, Entry> {
  const cached = cache.get(ns);
  if (cached) return cached;
  let table: Record<string, Entry> = {};
  try {
    const raw = localStorage.getItem(storageKey(ns));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      table = parsed as Record<string, Entry>;
    }
  } catch {
    // unreadable or unavailable: start empty
  }
  cache.set(ns, table);
  return table;
}

export function frecencyScore(entry: Entry | undefined, now: number): number {
  if (!entry || typeof entry.uses !== "number" || typeof entry.last !== "number") return 0;
  const score = entry.uses * Math.pow(0.5, (now - entry.last) / HALF_LIFE_MS);
  return score < MIN_SCORE ? 0 : score;
}

export function recordUse(ns: FrecencyNamespace, key: string, now = Date.now()): void {
  const table = load(ns);
  const prev = table[key];
  table[key] = { uses: (prev?.uses ?? 0) + 1, last: now };

  // Over the cap, drop the weakest, never the entry just used: a full table of strong
  // entries would otherwise evict every newcomer on arrival.
  const others = Object.keys(table).filter((k) => k !== key);
  if (others.length + 1 > MAX_ENTRIES) {
    others.sort((a, b) => frecencyScore(table[a], now) - frecencyScore(table[b], now));
    for (const k of others.slice(0, others.length + 1 - MAX_ENTRIES)) delete table[k];
  }
  try {
    localStorage.setItem(storageKey(ns), JSON.stringify(table));
  } catch {
    // full or unavailable: ordering is best effort
  }
}

/**
 * Items reordered by frecency, highest first. The sort is stable, so items never chosen
 * (score 0) keep the order they came in: the caller's relevance or registry order.
 */
export function rankByFrecency<T>(
  ns: FrecencyNamespace,
  items: T[],
  keyOf: (item: T) => string,
  now = Date.now(),
): T[] {
  const table = load(ns);
  return items
    .map((item, i) => ({ item, i, score: frecencyScore(table[keyOf(item)], now) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item);
}

/** Test hook: forget the in-memory tables so the next read goes to storage. */
export function resetFrecencyCache(): void {
  cache.clear();
}
