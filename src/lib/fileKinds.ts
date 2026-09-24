/**
 * Which files the editor opens, and how. Markdown gets the full note editor (preview,
 * links, tags, lint). Plain text files (.txt, .json, .yaml) open in Source mode only,
 * with syntax highlighting where a language exists, and are neither indexed nor linted.
 * Canvases (.canvas) open in the canvas view.
 */

export const PLAIN_TEXT_EXTENSIONS = ["txt", "json", "yaml", "yml"];

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** A board of cards and edges (JSON Canvas), shown by the canvas view rather than the editor. */
export const isCanvasPath = (path: string): boolean => extensionOf(path) === "canvas";

export const isMarkdownPath = (path: string): boolean => extensionOf(path) === "md";

export const isPlainTextPath = (path: string): boolean => PLAIN_TEXT_EXTENSIONS.includes(extensionOf(path));
