import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import {
  StateField,
  StateEffect,
  RangeSetBuilder,
  type Extension,
} from "@codemirror/state";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { previewModeField, togglePreviewEffect } from "./livePreview";
import { wikilinkFollowRef } from "./wikilinks";
import { useAppStore, selectActiveTabPath } from "../stores/app";

// ── Regex ──

const EMBED_RE = /^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*$/;


// ── Embed cache ──

interface CacheEntry {
  content: string;
  status: "loading" | "ready" | "error";
  error?: string;
}

const embedCache = new Map<string, CacheEntry>();
const inflightFetches = new Map<string, Promise<void>>();
/** Reverse map: resolved absolute path → set of link names that resolved to it */
const pathToLinks = new Map<string, Set<string>>();

function registerPathLink(resolvedPath: string, link: string) {
  let links = pathToLinks.get(resolvedPath);
  if (!links) { links = new Set(); pathToLinks.set(resolvedPath, links); }
  links.add(link);
}

// ── Effects ──

const embedContentReady = StateEffect.define<void>();

// ── View registry (for dispatching effects from event listeners) ──

const activeViews = new Set<EditorView>();

// ── fs:change listener (set up once) ──

let fsListenerInit = false;

function initFsListener() {
  if (fsListenerInit) return;
  fsListenerInit = true;
  listen<{ kind: string; path: string }>("fs:change", (event) => {
    const { path } = event.payload;
    // Invalidate the resolved-path entry and all link-name entries that map to it
    const links = pathToLinks.get(path);
    if (!embedCache.has(path) && !links) return;
    embedCache.delete(path);
    inflightFetches.delete(path);
    if (links) {
      for (const link of links) {
        embedCache.delete(link);
        inflightFetches.delete(link);
      }
      pathToLinks.delete(path);
    }
    for (const view of activeViews) {
      view.dispatch({ effects: embedContentReady.of(undefined) });
    }
  });
}

// ── Async resolve + fetch ──

async function resolveAndFetch(
  view: EditorView,
  link: string,
  contextPath: string,
  depth: number,
  ancestors: Set<string>,
): Promise<void> {
  // Resolve the wikilink to an absolute path
  let resolvedPath: string | null;
  try {
    resolvedPath = await invoke<string | null>("resolve_wikilink", {
      link,
      contextPath,
    });
  } catch {
    embedCache.set(link, { content: "", status: "error", error: "Failed to resolve link" });
    view.dispatch({ effects: embedContentReady.of(undefined) });
    return;
  }

  if (!resolvedPath) {
    embedCache.set(link, { content: "", status: "error", error: "Note not found" });
    view.dispatch({ effects: embedContentReady.of(undefined) });
    return;
  }

  // Cache by resolved path as well
  if (ancestors.has(resolvedPath)) {
    embedCache.set(link, { content: "", status: "error", error: "Circular embed" });
    embedCache.set(resolvedPath, { content: "", status: "error", error: "Circular embed" });
    registerPathLink(resolvedPath, link);
    view.dispatch({ effects: embedContentReady.of(undefined) });
    return;
  }

  try {
    const content = await invoke<string>("read_file", { path: resolvedPath });
    const entry: CacheEntry = { content, status: "ready" };
    embedCache.set(link, entry);
    embedCache.set(resolvedPath, entry);
    registerPathLink(resolvedPath, link);

    // Pre-fetch nested embeds (depth + 1) if within cap
    if (depth < 1) {
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(resolvedPath);
      const lines = content.split("\n");
      for (const line of lines) {
        const m = line.match(EMBED_RE);
        if (m) {
          const nestedLink = m[1];
          if (!embedCache.has(nestedLink)) {
            embedCache.set(nestedLink, { content: "", status: "loading" });
            await resolveAndFetch(view, nestedLink, resolvedPath, depth + 1, nextAncestors);
          }
        }
      }
    }
  } catch {
    embedCache.set(link, { content: "", status: "error", error: "Failed to read file" });
    embedCache.set(resolvedPath, { content: "", status: "error", error: "Failed to read file" });
    registerPathLink(resolvedPath, link);
  }

  view.dispatch({ effects: embedContentReady.of(undefined) });
}

function triggerFetch(view: EditorView, link: string, contextPath: string, depth: number, ancestors: Set<string>) {
  const key = `${link}:${contextPath}`;
  if (inflightFetches.has(key)) return;
  embedCache.set(link, { content: "", status: "loading" });
  const p = resolveAndFetch(view, link, contextPath, depth, ancestors).finally(() => {
    inflightFetches.delete(key);
  });
  inflightFetches.set(key, p);
}

// ── Lightweight markdown → HTML ──

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderMarkdownToHtml(
  content: string,
  depth: number,
  ancestors: Set<string>,
  contextPath: string,
): string {
  const lines = content.split("\n");
  const parts: string[] = [];
  let inFrontmatter = false;
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Frontmatter detection
    if (i === 0 && raw.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (raw.trim() === "---") {
        inFrontmatter = false;
      }
      continue;
    }

    // Code blocks
    if (raw.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        parts.push(`<pre class="cm-embed-code"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(raw);
      continue;
    }

    // Nested embed
    const embedMatch = raw.match(EMBED_RE);
    if (embedMatch) {
      const nestedLink = embedMatch[1];
      if (depth >= 1) {
        // Depth cap — show as link
        parts.push(`<div class="cm-embed-depth-cap">![[${escapeHtml(nestedLink)}]]</div>`);
      } else {
        const cached = embedCache.get(nestedLink);
        if (cached && cached.status === "ready" && !ancestors.has(nestedLink)) {
          const nextAncestors = new Set(ancestors);
          nextAncestors.add(contextPath);
          parts.push(`<div class="cm-embed-nested">`);
          parts.push(`<div class="cm-embed-nested-header">${escapeHtml(nestedLink)}</div>`);
          parts.push(`<div class="cm-embed-nested-content">${renderMarkdownToHtml(cached.content, depth + 1, nextAncestors, contextPath)}</div>`);
          parts.push(`</div>`);
        } else if (cached && cached.status === "error") {
          parts.push(`<div class="cm-embed-error">${escapeHtml(cached.error || "Error")}</div>`);
        } else {
          parts.push(`<div class="cm-embed-loading-inline">Loading ${escapeHtml(nestedLink)}...</div>`);
        }
      }
      continue;
    }

    // Headings
    const headingMatch = raw.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length + 1, 6); // Bump by 1
      parts.push(`<h${level} class="cm-embed-heading">${renderInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule (skip `---` only when it could be a frontmatter closer on line 2)
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(raw)) {
      parts.push(`<hr class="cm-embed-hr">`);
      continue;
    }

    // Blockquote
    if (raw.startsWith(">")) {
      parts.push(`<blockquote class="cm-embed-blockquote">${renderInline(raw.replace(/^>\s?/, ""))}</blockquote>`);
      continue;
    }

    // List items
    const ulMatch = raw.match(/^(\s*)([-*+])\s(.*)/);
    if (ulMatch) {
      const checkMatch = ulMatch[3].match(/^\[([ x])\]\s?(.*)/);
      if (checkMatch) {
        const checked = checkMatch[1] === "x";
        parts.push(`<div class="cm-embed-list-item" style="padding-left:${(ulMatch[1].length / 2 + 1) * 16}px"><span class="cm-embed-checkbox ${checked ? "checked" : ""}"></span>${renderInline(checkMatch[2])}</div>`);
      } else {
        parts.push(`<div class="cm-embed-list-item" style="padding-left:${(ulMatch[1].length / 2 + 1) * 16}px"><span class="cm-embed-bullet"></span>${renderInline(ulMatch[3])}</div>`);
      }
      continue;
    }

    const olMatch = raw.match(/^(\s*)(\d+)\.\s(.*)/);
    if (olMatch) {
      parts.push(`<div class="cm-embed-list-item" style="padding-left:${(olMatch[1].length / 2 + 1) * 16}px"><span class="cm-embed-ol-num">${olMatch[2]}.</span> ${renderInline(olMatch[3])}</div>`);
      continue;
    }

    // Empty line
    if (raw.trim() === "") {
      parts.push(`<div class="cm-embed-spacer"></div>`);
      continue;
    }

    // Paragraph
    parts.push(`<p class="cm-embed-para">${renderInline(raw)}</p>`);
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length) {
    parts.push(`<pre class="cm-embed-code"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  return parts.join("\n");
}

function renderInline(text: string): string {
  let s = escapeHtml(text);
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/_(.+?)_/g, "<em>$1</em>");
  // Strikethrough
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
  // Highlight
  s = s.replace(/==(.+?)==/g, '<mark class="cm-embed-highlight">$1</mark>');
  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code class="cm-embed-inline-code">$1</code>');
  // Wikilinks
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, link, alias) => {
    const display = alias || link;
    return `<span class="cm-embed-wikilink" data-link="${escapeHtml(link)}">${display}</span>`;
  });
  // Tags
  s = s.replace(/(?<=^|\s)#([a-zA-Z][\w/-]*)/g, '<span class="cm-embed-tag">#$1</span>');
  return s;
}

// ── Widgets ──

class EmbedWidget extends WidgetType {
  link: string;
  content: string;
  depth: number;
  ancestors: Set<string>;
  contextPath: string;

  constructor(link: string, content: string, depth: number, ancestors: Set<string>, contextPath: string) {
    super();
    this.link = link;
    this.content = content;
    this.depth = depth;
    this.ancestors = ancestors;
    this.contextPath = contextPath;
  }

  eq(other: EmbedWidget): boolean {
    return this.link === other.link && this.content === other.content && this.depth === other.depth;
  }

  get estimatedHeight(): number {
    const lineCount = this.content.split("\n").length;
    return Math.min(lineCount * 24 + 40, 440); // header + content, capped
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-embed-block";
    if (this.depth > 0) wrap.classList.add("cm-embed-nested");

    // Header
    const header = document.createElement("div");
    header.className = "cm-embed-header";
    header.textContent = this.link;
    header.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      wikilinkFollowRef.current?.(this.link, true, false);
    });
    wrap.appendChild(header);

    // Content
    const body = document.createElement("div");
    body.className = "cm-embed-content";
    body.innerHTML = renderMarkdownToHtml(this.content, this.depth, this.ancestors, this.contextPath);

    // Wikilink clicks inside content
    body.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const wl = target.closest<HTMLElement>(".cm-embed-wikilink");
      if (wl) {
        e.preventDefault();
        e.stopPropagation();
        const link = wl.dataset.link;
        if (link) wikilinkFollowRef.current?.(link, true, false);
      }
    });

    wrap.appendChild(body);
    return wrap;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "mousedown";
  }
}

class EmbedLoadingWidget extends WidgetType {
  link: string;

  constructor(link: string) {
    super();
    this.link = link;
  }

  eq(other: EmbedLoadingWidget): boolean {
    return this.link === other.link;
  }

  get estimatedHeight(): number {
    return 40;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-embed-block cm-embed-loading";
    const inner = document.createElement("div");
    inner.className = "cm-embed-loading-text";
    inner.textContent = `Loading ${this.link}...`;
    wrap.appendChild(inner);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class EmbedErrorWidget extends WidgetType {
  link: string;
  error: string;

  constructor(link: string, error: string) {
    super();
    this.link = link;
    this.error = error;
  }

  eq(other: EmbedErrorWidget): boolean {
    return this.link === other.link && this.error === other.error;
  }

  get estimatedHeight(): number {
    return 40;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-embed-block cm-embed-error-block";
    const inner = document.createElement("div");
    inner.className = "cm-embed-error";
    inner.textContent = this.error === "Circular embed"
      ? `Circular embed: ${this.link}`
      : `${this.link} — ${this.error}`;
    wrap.appendChild(inner);
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ── StateField ──

function buildEmbedDecos(state: import("@codemirror/state").EditorState, view?: EditorView): DecorationSet {
  const preview = state.field(previewModeField);
  if (!preview) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  const cursorLine = state.selection.main.head;
  const cursorLineNumber = doc.lineAt(cursorLine).number;
  const contextPath = selectActiveTabPath(useAppStore.getState()) || "";

  // Scan only visible ranges (with margin) to avoid full-document iteration
  const ranges = view?.visibleRanges ?? [{ from: 0, to: doc.length }];
  const margin = 2000; // scan slightly beyond viewport for smooth scrolling
  const processedLines = new Set<number>();
  for (const { from, to } of ranges) {
    const startLine = doc.lineAt(Math.max(0, from - margin)).number;
    const endLine = doc.lineAt(Math.min(doc.length, to + margin)).number;

    for (let i = startLine; i <= endLine; i++) {
      if (processedLines.has(i)) continue;
      processedLines.add(i);
      const line = doc.line(i);
      const match = line.text.match(EMBED_RE);
      if (!match) continue;

      // Show raw markdown on cursor line
      if (i === cursorLineNumber) continue;

      const link = match[1];
      const cached = embedCache.get(link);

      if (!cached || cached.status === "loading") {
        if (view && !cached) {
          triggerFetch(view, link, contextPath, 0, new Set([contextPath]));
        }
        builder.add(line.from, line.to, Decoration.replace({
          widget: new EmbedLoadingWidget(link),
        }));
      } else if (cached.status === "error") {
        builder.add(line.from, line.to, Decoration.replace({
          widget: new EmbedErrorWidget(link, cached.error || "Error"),
        }));
      } else {
        const ancestors = new Set([contextPath]);
        builder.add(line.from, line.to, Decoration.replace({
          widget: new EmbedWidget(link, cached.content, 0, ancestors, contextPath),
        }));
      }
    }
  }

  return builder.finish();
}

const embedBlockField = StateField.define<DecorationSet>({
  create(state) {
    return buildEmbedDecos(state);
  },
  update(decos, tr) {
    if (
      tr.docChanged ||
      tr.selection !== tr.startState.selection ||
      tr.effects.some((e) => e.is(togglePreviewEffect) || e.is(embedContentReady))
    ) {
      // Pass the view through for async fetches
      const view = (activeViews.size > 0) ? activeViews.values().next().value as EditorView : undefined;
      return buildEmbedDecos(tr.state, view);
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── ViewPlugin to track active views ──

const embedViewTracker = ViewPlugin.define((view) => {
  activeViews.add(view);
  // Trigger initial fetch for any embeds visible on mount
  const state = view.state;
  const preview = state.field(previewModeField);
  if (preview) {
    const contextPath = selectActiveTabPath(useAppStore.getState()) || "";
    const doc = state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const match = doc.line(i).text.match(EMBED_RE);
      if (match && !embedCache.has(match[1])) {
        triggerFetch(view, match[1], contextPath, 0, new Set([contextPath]));
      }
    }
  }
  return {
    destroy() {
      activeViews.delete(view);
    },
  };
});

// ── Theme ──

const embedTheme = EditorView.theme({
  ".cm-embed-block": {
    border: "1px solid var(--border-default, #333)",
    borderRadius: "6px",
    margin: "4px 0",
    overflow: "hidden",
    background: "var(--bg-elevated, #1a1a1a)",
  },
  ".cm-embed-header": {
    padding: "4px 10px",
    fontSize: "0.85em",
    color: "var(--text-muted, #888)",
    borderBottom: "1px solid var(--border-subtle, #2a2a2a)",
    background: "var(--bg-subtle, #141414)",
    cursor: "pointer",
    userSelect: "none",
  },
  ".cm-embed-header:hover": {
    color: "var(--link-color, #7ab0ff)",
  },
  ".cm-embed-content": {
    padding: "8px 12px",
    fontSize: "0.95em",
    lineHeight: "1.6",
    maxHeight: "400px",
    overflowY: "auto",
  },
  ".cm-embed-loading": {
    borderStyle: "dashed",
    opacity: "0.6",
  },
  ".cm-embed-loading-text": {
    padding: "8px 12px",
    fontSize: "0.85em",
    color: "var(--text-muted, #888)",
  },
  ".cm-embed-error-block": {
    borderColor: "var(--error, #e55)",
    borderStyle: "dashed",
  },
  ".cm-embed-error": {
    padding: "8px 12px",
    fontSize: "0.85em",
    color: "var(--error, #e55)",
  },
  // Nested embeds
  ".cm-embed-nested": {
    border: "1px solid var(--border-subtle, #2a2a2a)",
    borderRadius: "4px",
    margin: "4px 0",
    overflow: "hidden",
  },
  ".cm-embed-nested-header": {
    padding: "3px 8px",
    fontSize: "0.8em",
    color: "var(--text-muted, #888)",
    background: "var(--bg-subtle, #141414)",
    borderBottom: "1px solid var(--border-subtle, #2a2a2a)",
  },
  ".cm-embed-nested-content": {
    padding: "6px 10px",
    fontSize: "0.93em",
  },
  ".cm-embed-depth-cap": {
    color: "var(--link-color, #7ab0ff)",
    fontSize: "0.88em",
    padding: "2px 0",
  },
  // Rendered markdown elements
  ".cm-embed-heading": {
    fontWeight: "600",
    margin: "0.3em 0 0.1em",
  },
  ".cm-embed-hr": {
    border: "none",
    borderTop: "1px solid var(--border-subtle, #2a2a2a)",
    margin: "0.4em 0",
  },
  ".cm-embed-blockquote": {
    borderLeft: "3px solid var(--border-default, #333)",
    paddingLeft: "10px",
    margin: "0.2em 0",
    color: "var(--text-muted, #888)",
  },
  ".cm-embed-para": {
    margin: "0.2em 0",
  },
  ".cm-embed-spacer": {
    height: "0.4em",
  },
  ".cm-embed-list-item": {
    margin: "0.1em 0",
  },
  ".cm-embed-bullet::before": {
    content: "'•'",
    marginRight: "6px",
    color: "var(--text-muted, #888)",
  },
  ".cm-embed-ol-num": {
    color: "var(--text-muted, #888)",
    marginRight: "2px",
  },
  ".cm-embed-checkbox": {
    display: "inline-block",
    width: "14px",
    height: "14px",
    border: "1.5px solid var(--text-muted, #888)",
    borderRadius: "3px",
    verticalAlign: "middle",
    marginRight: "6px",
  },
  ".cm-embed-checkbox.checked": {
    background: "var(--accent, #7ab0ff)",
    borderColor: "var(--accent, #7ab0ff)",
  },
  ".cm-embed-wikilink": {
    color: "var(--link-color, #7ab0ff)",
    cursor: "pointer",
    textDecoration: "var(--link-underline, underline)",
    textUnderlineOffset: "2px",
  },
  ".cm-embed-tag": {
    background: "var(--tag-bg, #2a2a3a)",
    color: "var(--tag-text, #aaa)",
    borderRadius: "9px",
    padding: "1px 8px",
    fontSize: "0.88em",
  },
  ".cm-embed-highlight": {
    background: "var(--syntax-highlight-bg, rgba(255, 204, 0, 0.3))",
    borderRadius: "2px",
    padding: "1px 0",
  },
  ".cm-embed-inline-code": {
    fontFamily: "var(--mono-font, 'IBM Plex Mono', monospace)",
    fontSize: "0.9em",
    background: "var(--bg-subtle, #141414)",
    borderRadius: "3px",
    padding: "1px 4px",
  },
  ".cm-embed-code": {
    fontFamily: "var(--mono-font, 'IBM Plex Mono', monospace)",
    fontSize: "0.88em",
    background: "var(--bg-subtle, #141414)",
    borderRadius: "4px",
    padding: "8px 10px",
    margin: "0.3em 0",
    overflowX: "auto",
    whiteSpace: "pre",
  },
  ".cm-embed-loading-inline": {
    color: "var(--text-muted, #888)",
    fontSize: "0.85em",
    fontStyle: "italic",
    padding: "2px 0",
  },
});

// ── Export ──

export function embedExtension(): Extension[] {
  initFsListener();
  return [embedBlockField, embedViewTracker, embedTheme];
}
