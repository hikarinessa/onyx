/**
 * Simple IPC query cache — reduces redundant Rust calls when switching tabs rapidly.
 * TTL-based with invalidation on file-change events.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const DEFAULT_TTL = 5000; // 5 seconds

const cache = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string, ttl = DEFAULT_TTL): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > ttl) {
    cache.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

/** Invalidate all entries, or entries matching a prefix */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
