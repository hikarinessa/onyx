import { beforeEach, describe, expect, it, vi } from "vitest";

// The store talks to Rust through invoke and to the app store; both are stood in for here
const disk = new Map<string, string>();
const writes: { path: string; content: string }[] = [];
let refuseWith: string | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: { path: string; content?: string }) => {
    if (cmd === "read_file") return disk.get(args.path) ?? "";
    if (cmd === "write_file") {
      if (refuseWith) throw refuseWith;
      writes.push({ path: args.path, content: args.content! });
      disk.set(args.path, args.content!);
      return "ok";
    }
    throw new Error(`unexpected ${cmd}`);
  }),
}));

const appState = {
  modified: new Map<string, boolean>(),
  conflict: null as string | null,
  deletedPaths: new Set<string>(),
  setModified: (id: string, m: boolean) => appState.modified.set(id, m),
  setSaveConflictPath: (p: string | null) => { appState.conflict = p; },
  addDeletedPath: (p: string) => appState.deletedPaths.add(p),
};
vi.mock("../../stores/app", () => ({ useAppStore: { getState: () => appState } }));
vi.mock("../configBridge", () => ({ getAutoSaveMs: () => 10 }));

const { loadCanvas, getCanvasDoc, commit, undo, redo, flushCanvasSave, canvasChangedOnDisk, checkpoint } =
  await import("./store");
const { newSticky, serializeCanvas, parseCanvas } = await import("./model");

const PATH = "/root/board.canvas";
const ORIGINAL = `{"nodes":[{"id":"a","type":"text","text":"hi","x":0,"y":0,"width":100,"height":100,"extra":1}],"edges":[]}`;

beforeEach(async () => {
  disk.clear();
  writes.length = 0;
  refuseWith = null;
  appState.modified.clear();
  appState.conflict = null;
  disk.set(PATH, ORIGINAL);
  await loadCanvas(PATH);
});

describe("canvas store", () => {
  it("loads without writing", () => {
    expect(getCanvasDoc(PATH)?.nodes[0].id).toBe("a");
    expect(writes).toEqual([]);
  });

  it("marks a change modified and saves it, keeping unknown fields", async () => {
    const doc = getCanvasDoc(PATH)!;
    commit(PATH, { ...doc, nodes: [...doc.nodes, newSticky(10, 10)] });
    expect(appState.modified.get(PATH)).toBe(true);
    await flushCanvasSave(PATH);
    expect(writes).toHaveLength(1);
    const saved = parseCanvas(writes[0].content);
    expect(saved.nodes).toHaveLength(2);
    expect(saved.nodes[0].extra).toBe(1);
    expect(appState.modified.get(PATH)).toBe(false);
  });

  it("saves on its own after the auto-save delay", async () => {
    const doc = getCanvasDoc(PATH)!;
    commit(PATH, { ...doc, nodes: [] });
    await new Promise((r) => setTimeout(r, 40));
    expect(writes).toHaveLength(1);
  });

  it("undoes and redoes, and an undo back to the file clears modified", () => {
    const doc = getCanvasDoc(PATH)!;
    commit(PATH, { ...doc, nodes: [] });
    undo(PATH);
    expect(getCanvasDoc(PATH)?.nodes).toHaveLength(1);
    expect(appState.modified.get(PATH)).toBe(false);
    redo(PATH);
    expect(getCanvasDoc(PATH)?.nodes).toHaveLength(0);
  });

  it("merges a run of coalesced changes into one undo step", () => {
    const set = (text: string) => {
      const d = getCanvasDoc(PATH)!;
      commit(PATH, { ...d, nodes: d.nodes.map((n) => ({ ...n, text })) }, { coalesce: "text:a" });
    };
    set("h"); set("he"); set("hel");
    undo(PATH);
    expect(getCanvasDoc(PATH)?.nodes[0].text).toBe("hi");
  });

  it("takes a drag as one step: checkpoint, then changes without history", () => {
    checkpoint(PATH);
    for (const x of [5, 10, 15]) {
      const d = getCanvasDoc(PATH)!;
      commit(PATH, { ...d, nodes: d.nodes.map((n) => ({ ...n, x })) }, { history: false });
    }
    undo(PATH);
    expect(getCanvasDoc(PATH)?.nodes[0].x).toBe(0);
  });

  it("ignores its own write coming back from the watcher", async () => {
    const doc = getCanvasDoc(PATH)!;
    commit(PATH, { ...doc, nodes: [] });
    await flushCanvasSave(PATH);
    const before = getCanvasDoc(PATH);
    canvasChangedOnDisk(PATH, disk.get(PATH)!);
    expect(getCanvasDoc(PATH)).toBe(before);
  });

  it("takes an outside change when there is nothing unsaved, as an undoable step", () => {
    const outside = serializeCanvas({ nodes: [], edges: [] });
    canvasChangedOnDisk(PATH, outside);
    expect(getCanvasDoc(PATH)?.nodes).toHaveLength(0);
    undo(PATH);
    expect(getCanvasDoc(PATH)?.nodes).toHaveLength(1);
  });

  it("keeps unsaved changes and raises the conflict prompt on an outside change", () => {
    const doc = getCanvasDoc(PATH)!;
    commit(PATH, { ...doc, nodes: [...doc.nodes, newSticky(0, 0)] });
    canvasChangedOnDisk(PATH, serializeCanvas({ nodes: [], edges: [] }));
    expect(getCanvasDoc(PATH)?.nodes).toHaveLength(2);
    expect(appState.conflict).toBe(PATH);
  });

  it("stays modified when the save is refused as a conflict", async () => {
    refuseWith = "CONFLICT:File was modified externally.";
    const doc = getCanvasDoc(PATH)!;
    commit(PATH, { ...doc, nodes: [] });
    await flushCanvasSave(PATH);
    expect(appState.conflict).toBe(PATH);
    expect(appState.modified.get(PATH)).toBe(true);
  });
});
