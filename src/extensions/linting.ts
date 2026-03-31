import { linter, type Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { isLintingEnabled, getLintRules, getTabSize } from "../lib/configBridge";
import { useAppStore, type LintIssue } from "../stores/app";

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
            view.dispatch({ changes: { from, to: from + 1, insert: " ".repeat(getTabSize()) } });
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
        const from = line.from + match[1].length;
        const to = from + 1;
        const expected = firstMarker;
        diagnostics.push({
          from,
          to,
          severity: "error",
          message: `Inconsistent list marker "${marker}" (expected "${expected}")`,
          actions: [{
            name: "Fix",
            apply: (view) => {
              view.dispatch({ changes: { from, to, insert: expected } });
            },
          }],
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
    if (/^[-*_]{3,}$/.test(trimmed) && trimmed !== "---") {
      // Allow --- at doc start (frontmatter delimiter)
      if (trimmed === "---" && i <= 2) continue;
      diagnostics.push({
        from: line.from,
        to: line.to,
        severity: "warning",
        message: "Use --- for horizontal rules",
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
// All rules — keyed by config field name
// ---------------------------------------------------------------------------

type RuleKey = keyof ReturnType<typeof getLintRules>;

const ALL_RULES: { key: RuleKey; rule: LintRule }[] = [
  { key: "trailing_spaces", rule: noTrailingSpaces },
  { key: "hard_tabs", rule: noHardTabs },
  { key: "multiple_blanks", rule: noMultipleBlanks },
  { key: "trailing_newline", rule: singleTrailingNewline },
  { key: "atx_spacing", rule: noMissingSpaceAtx },
  { key: "reversed_links", rule: noReversedLinks },
  { key: "space_in_emphasis", rule: noSpaceInEmphasis },
  { key: "heading_increment", rule: headingIncrement },
  { key: "consistent_list_marker", rule: consistentListMarker },
  { key: "hr_style", rule: hrStyle },
  { key: "empty_links", rule: noEmptyLinks },
];

// ---------------------------------------------------------------------------
// Autofix — string-based fixer for save-time application
// ---------------------------------------------------------------------------

export function autofixContent(content: string): string {
  let result = content;
  const rules = getLintRules();

  if (rules.trailing_spaces) result = result.replace(/[ \t]+$/gm, "");
  if (rules.hard_tabs) result = result.replace(/\t/g, " ".repeat(getTabSize()));
  if (rules.multiple_blanks) result = result.replace(/\n{3,}/g, "\n\n");
  if (rules.trailing_newline) result = result.replace(/\n*$/, "\n");
  if (rules.atx_spacing) result = result.replace(/^(#{1,6})([^ #\n])/gm, "$1 $2");
  if (rules.reversed_links) result = result.replace(/\(([^)]+)\)\[([^\]]+)\]/g, "[$1]($2)");
  if (rules.consistent_list_marker) {
    const lines = result.split("\n");
    let firstMarker: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)([-*+]) /);
      if (m) {
        if (firstMarker === null) {
          firstMarker = m[2];
        } else if (m[2] !== firstMarker) {
          lines[i] = lines[i].substring(0, m[1].length) + firstMarker + lines[i].substring(m[1].length + 1);
        }
      }
    }
    result = lines.join("\n");
  }

  return result;
}

// ---------------------------------------------------------------------------
// CM6 Extension
// ---------------------------------------------------------------------------

/** Map of issue ID → Diagnostic (with actions). Refreshed each lint pass. */
const diagnosticMap = new Map<string, Diagnostic>();

/** Apply the fix action for a single lint issue by ID. */
export function applyLintFix(issueId: string, view: import("@codemirror/view").EditorView): boolean {
  const d = diagnosticMap.get(issueId);
  if (!d?.actions?.length) return false;
  d.actions[0].apply(view, d.from, d.to);
  return true;
}

export function lintingExtension(): Extension[] {
  const lintSource = linter((view) => {
    if (!isLintingEnabled()) {
      useAppStore.getState().setLintDiagnostics([]);
      useAppStore.getState().setLintCounts(0, 0);
      diagnosticMap.clear();
      return [];
    }

    const doc = view.state.doc;
    const diagnostics: Diagnostic[] = [];
    const rules = getLintRules();

    for (const { key, rule } of ALL_RULES) {
      if (rules[key]) {
        diagnostics.push(...rule(doc));
      }
    }

    // Push serializable issues to the store for the lint panel
    diagnosticMap.clear();
    let errors = 0;
    let warnings = 0;
    const issues: LintIssue[] = diagnostics.map((d, i) => {
      const line = doc.lineAt(d.from);
      const sev = d.severity === "error" ? "error" as const : "warning" as const;
      if (sev === "error") errors++;
      else warnings++;
      const id = `${d.from}-${d.to}-${i}`;
      diagnosticMap.set(id, d);
      return {
        id,
        from: d.from,
        to: d.to,
        line: line.number,
        col: d.from - line.from + 1,
        message: d.message,
        severity: sev,
        fixable: (d.actions?.length ?? 0) > 0,
      };
    });
    useAppStore.getState().setLintDiagnostics(issues);
    useAppStore.getState().setLintCounts(errors, warnings);

    return diagnostics;
  }, { delay: 500 });

  return [lintSource];
}
