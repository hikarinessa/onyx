import { beforeEach, describe, expect, it } from "vitest";
import { frecencyScore, rankByFrecency, recordUse, resetFrecencyCache } from "./frecency";

const DAY = 24 * 60 * 60 * 1000;

// The suites run in node, which has no localStorage; a map stands in for it.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

beforeEach(() => {
  store.clear();
  resetFrecencyCache();
});

describe("frecency", () => {
  it("halves a use's weight after a week", () => {
    expect(frecencyScore({ uses: 4, last: 0 }, 7 * DAY)).toBeCloseTo(2);
  });

  it("puts used items first and keeps the incoming order for the rest", () => {
    const now = 100 * DAY;
    recordUse("commands", "c", now);
    const ranked = rankByFrecency("commands", ["a", "b", "c", "d"], (x) => x, now);
    expect(ranked).toEqual(["c", "a", "b", "d"]);
  });

  it("ranks a recent use above an older, more frequent one once enough time passes", () => {
    const now = 100 * DAY;
    for (let i = 0; i < 3; i++) recordUse("files", "old", now - 30 * DAY);
    recordUse("files", "new", now);
    expect(rankByFrecency("files", ["old", "new"], (x) => x, now)).toEqual(["new", "old"]);
  });

  it("persists across a reload", () => {
    recordUse("files", "/a.md", 1000);
    resetFrecencyCache();
    expect(rankByFrecency("files", ["/b.md", "/a.md"], (x) => x, 1000)).toEqual(["/a.md", "/b.md"]);
  });

  it("treats a long-unused entry as never used", () => {
    const now = 100 * DAY;
    recordUse("files", "stale", now - 60 * DAY);
    expect(rankByFrecency("files", ["best", "stale"], (x) => x, now)).toEqual(["best", "stale"]);
  });

  it("keeps the entry just used when the table is full of stronger ones", () => {
    const now = 100 * DAY;
    for (let i = 0; i < 500; i++) {
      recordUse("files", `k${i}`, now);
      recordUse("files", `k${i}`, now);
    }
    recordUse("files", "newcomer", now);
    const stored = JSON.parse(localStorage.getItem("onyx-frecency-files")!);
    expect(stored.newcomer).toBeDefined();
    expect(Object.keys(stored)).toHaveLength(500);
  });

  it("survives a corrupt stored value", () => {
    localStorage.setItem("onyx-frecency-commands", "null");
    resetFrecencyCache();
    expect(rankByFrecency("commands", ["a", "b"], (x) => x, 1000)).toEqual(["a", "b"]);
    recordUse("commands", "b", 1000);
    expect(rankByFrecency("commands", ["a", "b"], (x) => x, 1000)).toEqual(["b", "a"]);
  });

  it("keeps namespaces apart", () => {
    recordUse("commands", "x", 1000);
    expect(rankByFrecency("files", ["y", "x"], (v) => v, 1000)).toEqual(["y", "x"]);
  });
});
