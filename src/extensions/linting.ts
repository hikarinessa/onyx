import { linter, type Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { isLintingEnabled } from "../lib/configBridge";

// ---------------------------------------------------------------------------
// Rule types
// ---------------------------------------------------------------------------

type LintRule = (doc: Text) => Diagnostic[];

// ---------------------------------------------------------------------------
// Tier 1 — Autofix rules (severity: error)
// ---------------------------------------------------------------------------

const noTrailingSpaces: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(/[ \t]+$/);
    if (match) {
      const from = line.to - match[0].length;
      diagnostics.push({
        from,
        to: line.to,
        severity: "error",
        message: "Trailing whitespace",
        actions: [{
          name: "Fix",
          apply: (view) => {
            view.dispatch({ changes: { from, to: line.to } });
          },
        }],
      });
    }
  }
  return diagnostics;
};

const noHardTabs: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    let idx = line.text.indexOf("\t");
    while (idx !== -1) {
      const from = line.from + idx;
      diagnostics.push({
        from,
        to: from + 1,
        severity: "error",
        message: "Hard tab (use spaces)",
        actions: [{
          name: "Fix",
          apply: (view) => {
            view.dispatch({ changes: { from, to: from + 1, insert: "    " } });
          },
        }],
      });
      idx = line.text.indexOf("\t", idx + 1);
    }
  }
  return diagnostics;
};

const noMultipleBlanks: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  let blankCount = 0;
  let blankStart = 0;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.text.trim() === "") {
      if (blankCount === 0) blankStart = line.from;
      blankCount++;
    } else {
      if (blankCount >= 3) {
        // Keep 2 blank lines (1 empty line = the gap)
        const keepEnd = doc.line(
          Math.min(doc.lineAt(blankStart).number + 1, doc.lines)
        ).to;
        const removeFrom = keepEnd;
        const removeTo = doc.line(i - 1).to;
        if (removeTo > removeFrom) {
          diagnostics.push({
            from: blankStart,
            to: removeTo,
            severity: "error",
            message: `${blankCount} consecutive blank lines (max 2)`,
            actions: [{
              name: "Fix",
              apply: (view) => {
                view.dispatch({ changes: { from: removeFrom, to: removeTo } });
              },
            }],
          });
        }
      }
      blankCount = 0;
    }
  }
  return diagnostics;
};

const singleTrailingNewline: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  const text = doc.toString();
  if (text.length === 0) return diagnostics;
  if (!text.endsWith("\n")) {
    diagnostics.push({
      from: doc.length,
      to: doc.length,
      severity: "error",
      message: "Missing trailing newline",
      actions: [{
        name: "Fix",
        apply: (view) => {
          view.dispatch({ changes: { from: doc.length, insert: "\n" } });
        },
      }],
    });
  } else if (text.endsWith("\n\n")) {
    // Multiple trailing newlines
    let end = text.length;
    while (end > 1 && text[end - 2] === "\n") end--;
    diagnostics.push({
      from: end,
      to: doc.length,
      severity: "error",
      message: "Multiple trailing newlines",
      actions: [{
        name: "Fix",
        apply: (view) => {
          view.dispatch({ changes: { from: end, to: doc.length } });
        },
      }],
    });
  }
  return diagnostics;
};

const noMissingSpaceAtx: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(/^(#{1,6})([^ #\n])/);
    if (match) {
      const insertPos = line.from + match[1].length;
      diagnostics.push({
        from: line.from,
        to: insertPos + 1,
        severity: "error",
        message: "Missing space after heading marker",
        actions: [{
          name: "Fix",
          apply: (view) => {
            view.dispatch({ changes: { from: insertPos, insert: " " } });
          },
        }],
      });
    }
  }
  return diagnostics;
};

const noReversedLinks: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  const re = /\(([^)]+)\)\[([^\]]+)\]/g;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    let match;
    while ((match = re.exec(line.text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;
      const fixed = `[${match[1]}](${match[2]})`;
      diagnostics.push({
        from,
        to,
        severity: "error",
        message: "Reversed link syntax",
        actions: [{
          name: "Fix",
          apply: (view) => {
            view.dispatch({ changes: { from, to, insert: fixed } });
          },
        }],
      });
    }
    re.lastIndex = 0;
  }
  return diagnostics;
};

const noSpaceInEmphasis: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  // Match * text * or _ text _ (with spaces after opening / before closing)
  const re = /(\*|_) (.+?) \1/g;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    let match;
    while ((match = re.exec(line.text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;
      const marker = match[1];
      const inner = match[2];
      const fixed = `${marker}${inner}${marker}`;
      diagnostics.push({
        from,
        to,
        severity: "error",
        message: "Space inside emphasis markers",
        actions: [{
          name: "Fix",
          apply: (view) => {
            view.dispatch({ changes: { from, to, insert: fixed } });
          },
        }],
      });
    }
    re.lastIndex = 0;
  }
  return diagnostics;
};

// ---------------------------------------------------------------------------
// Tier 2 — Warning-only rules
// ---------------------------------------------------------------------------

const headingIncrement: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  let lastLevel = 0;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(/^(#{1,6}) /);
    if (match) {
      const level = match[1].length;
      if (lastLevel > 0 && level > lastLevel + 1) {
        diagnostics.push({
          from: line.from,
          to: line.from + match[0].length,
          severity: "warning",
          message: `Heading level skipped (h${lastLevel} → h${level})`,
        });
      }
      lastLevel = level;
    }
  }
  return diagnostics;
};

const consistentListMarker: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  let firstMarker: string | null = null;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(/^(\s*)([-*+]) /);
    if (match) {
      const marker = match[2];
      if (firstMarker === null) {
        firstMarker = marker;
      } else if (marker !== firstMarker) {
        diagnostics.push({
          from: line.from + match[1].length,
          to: line.from + match[1].length + 1,
          severity: "warning",
          message: `Inconsistent list marker "${marker}" (expected "${firstMarker}")`,
        });
      }
    }
  }
  return diagnostics;
};

const hrStyle: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const trimmed = line.text.trim();
    if (/^[-*_]{3,}$/.test(trimmed) && trimmed !== "***" && trimmed !== "---") {
      // Allow --- only at doc start (frontmatter)
      if (trimmed === "---" && i <= 2) continue;
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: "warning",
        message: "Use *** for horizontal rules",
      });
    }
  }
  return diagnostics;
};

const noEmptyLinks: LintRule = (doc) => {
  const diagnostics: Diagnostic[] = [];
  const re = /\[([^\]]*)\]\(([^)]*)\)/g;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    let match;
    while ((match = re.exec(line.text)) !== null) {
      const text = match[1];
      const url = match[2];
      if (!text.trim() || !url.trim()) {
        const from = line.from + match.index;
        diagnostics.push({
          from,
          to: from + match[0].length,
          severity: "warning",
          message: !text.trim() ? "Empty link text" : "Empty link URL",
        });
      }
    }
    re.lastIndex = 0;
  }
  return diagnostics;
};

// ---------------------------------------------------------------------------
// All rules
// ---------------------------------------------------------------------------

const TIER1_RULES: LintRule[] = [
  noTrailingSpaces,
  noHardTabs,
  noMultipleBlanks,
  singleTrailingNewline,
  noMissingSpaceAtx,
  noReversedLinks,
  noSpaceInEmphasis,
];

const TIER2_RULES: LintRule[] = [
  headingIncrement,
  consistentListMarker,
  hrStyle,
  noEmptyLinks,
];

// ---------------------------------------------------------------------------
// Autofix — string-based fixer for save-time application
// ---------------------------------------------------------------------------

export function autofixContent(content: string): string {
  let result = content;

  // Trailing whitespace
  result = result.replace(/[ \t]+$/gm, "");

  // Hard tabs → spaces
  result = result.replace(/\t/g, "    ");

  // 3+ consecutive blank lines → 2
  result = result.replace(/\n{3,}/g, "\n\n");

  // Ensure single trailing newline
  result = result.replace(/\n*$/, "\n");

  // Missing space after ATX heading
  result = result.replace(/^(#{1,6})([^ #\n])/gm, "$1 $2");

  // Reversed links
  result = result.replace(/\(([^)]+)\)\[([^\]]+)\]/g, "[$1]($2)");

  return result;
}

// ---------------------------------------------------------------------------
// CM6 Extension
// ---------------------------------------------------------------------------

export function lintingExtension(): Extension[] {
  const lintSource = linter((view) => {
    if (!isLintingEnabled()) return [];

    const doc = view.state.doc;
    const diagnostics: Diagnostic[] = [];

    for (const rule of TIER1_RULES) {
      diagnostics.push(...rule(doc));
    }
    for (const rule of TIER2_RULES) {
      diagnostics.push(...rule(doc));
    }

    return diagnostics;
  }, { delay: 500 });

  return [lintSource];
}
