import { invoke } from "@tauri-apps/api/core";

let roots: string[] | null = null;

async function registeredRoots(): Promise<string[]> {
  if (!roots) {
    const dirs = await invoke<{ path: string }[]>("get_registered_directories").catch(() => []);
    // Longest first, so a root nested in another claims its own files
    roots = dirs.map((d) => d.path).sort((a, b) => b.length - a.length);
    setTimeout(() => { roots = null; }, 30_000);
  }
  return roots;
}

/**
 * How a canvas refers to a file: relative to the registered root the canvas lives in, as
 * Obsidian writes vault paths, or absolute when the file is outside that root.
 */
export async function canvasFileRef(absPath: string, canvasPath: string): Promise<string> {
  const root = (await registeredRoots()).find((r) => canvasPath.startsWith(r + "/"));
  return root && absPath.startsWith(root + "/") ? absPath.slice(root.length + 1) : absPath;
}
