/**
 * Which files the editor opens, and how. Markdown gets the full note editor (preview,
 * links, tags, lint). Plain text files (.txt, .json, .yaml) open in Source mode only,
 * with syntax highlighting where a language exists, and are neither indexed nor linted.
 */

export const PLAIN_TEXT_EXTENSIONS = ["txt", "json", "yaml", "yml"];

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export const isMarkdownPath = (path: string): boolean => extensionOf(path) === "md";

export const isPlainTextPath = (path: string): boolean => PLAIN_TEXT_EXTENSIONS.includes(extensionOf(path));
