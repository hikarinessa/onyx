import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useAppStore } from "../stores/app";

/**
 * Markdown linting extension for Onyx.
 *
 * Rules:
 * 1. ATX headings only (warn on setext underlines)
 * 2. Consistent list marker per file
 * 3. No duplicate headings (warning)
 * 4. Trailing whitespace (info — auto-fixed on save)
 * 5. Final newline (info — auto-fixed on save)
 * 6. Frontmatter validity (error on malformed YAML)
 */

const SETEXT_RE = /^(={3,}|-{3,})\s*$/;
const LIST_MARKER_RE = /^(\s*)([-*+]|\d+\.)\s/;
const HEADING_RE = /^(#{1,6})\s+(.+)/;

function markdownLinter(view: EditorView): Diagnostic[] {
  const doc = view.state.doc;
  const diagnostics: Diagnostic[] = [];
  const text = doc.toString();
  const lines = text.split("\n");

  // Track state
  let firstListMarker: string | null = null;
  const headingTexts = new Map<string, number>(); // text → first line number
  let inFrontmatter = false;
  let frontmatterClosed = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const docLine = doc.line(lineNum);

    // Frontmatter tracking
    if (i === 0 && line.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === "---") {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      continue;
    }

    // Code block tracking
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Rule 1: Setext headings
    if (i > 0 && SETEXT_RE.test(line) && lines[i - 1].trim().length > 0) {
      diagnostics.push({
        from: docLine.from,
        to: docLine.to,
        severity: "warning",
        message: "Use ATX headings (# style) instead of setext underlines",
      });
    }

    // Rule 2: Consistent list markers
    const listMatch = line.match(LIST_MARKER_RE);
    if (listMatch) {
      const marker = listMatch[2];
      // Normalize: treat all numbered markers as "1."
      const normalized = /^\d+\.$/.test(marker) ? "ordered" : marker;
      if (firstListMarker === null) {
        firstListMarker = normalized;
      } else if (
        normalized !== firstListMarker &&
        // Don't flag mixing of ordered and unordered
        !(normalized === "ordered" && firstListMarker !== "ordered") &&
        !(normalized !== "ordered" && firstListMarker === "ordered")
      ) {
        diagnostics.push({
          from: docLine.from + (listMatch[1]?.length ?? 0),
          to: docLine.from + (listMatch[1]?.length ?? 0) + marker.length,
          severity: "warning",
          message: `Inconsistent list marker: using '${marker}' but file started with '${firstListMarker}'`,
        });
      }
    }

    // Rule 3: Duplicate headings
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const headingText = headingMatch[2].trim().toLowerCase();
      if (headingTexts.has(headingText)) {
        diagnostics.push({
          from: docLine.from,
          to: docLine.to,
          severity: "warning",
          message: `Duplicate heading (first at line ${headingTexts.get(headingText)})`,
        });
      } else {
        headingTexts.set(headingText, lineNum);
      }
    }

    // Rule 4: Trailing whitespace
    if (line !== line.trimEnd() && line.trimEnd().length > 0) {
      const trimmed = line.trimEnd();
      diagnostics.push({
        from: docLine.from + trimmed.length,
        to: docLine.to,
        severity: "info",
        message: "Trailing whitespace (auto-fixed on save)",
      });
    }
  }

  // Rule 5: Final newline
  if (text.length > 0 && !text.endsWith("\n")) {
    const lastLine = doc.line(doc.lines);
    diagnostics.push({
      from: lastLine.to,
      to: lastLine.to,
      severity: "info",
      message: "Missing final newline (auto-fixed on save)",
    });
  }

  // Rule 6: Malformed frontmatter
  if (lines[0]?.trim() === "---" && !frontmatterClosed) {
    diagnostics.push({
      from: 0,
      to: doc.line(1).to,
      severity: "error",
      message: "Unclosed frontmatter: missing closing ---",
    });
  }

  // Report counts to store
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  useAppStore.getState().setLintCounts(errors, warnings);

  return diagnostics;
}

/** Auto-fix content before save: trim trailing whitespace, ensure final newline */
export function autoFixOnSave(content: string): string {
  // Trim trailing whitespace from each line
  let fixed = content
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  // Ensure final newline
  if (fixed.length > 0 && !fixed.endsWith("\n")) {
    fixed += "\n";
  }

  return fixed;
}

/** Linting theme */
const lintTheme = EditorView.theme({
  ".cm-lint-marker": {
    width: "6px",
  },
  ".cm-diagnostic": {
    padding: "3px 6px",
    fontSize: "12px",
    fontFamily: "var(--font-ui)",
  },
  ".cm-diagnostic-error": {
    borderLeft: "3px solid var(--status-error)",
  },
  ".cm-diagnostic-warning": {
    borderLeft: "3px solid var(--status-modified)",
  },
  ".cm-diagnostic-info": {
    borderLeft: "3px solid var(--text-tertiary)",
  },
});

/** Bundle linting extensions */
export function lintingExtension(): Extension[] {
  return [
    linter(markdownLinter, { delay: 1000 }),
    lintTheme,
  ];
}
