import type { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { invoke } from "@tauri-apps/api/core";

/**
 * Slash commands: triggered by / at start of line or after whitespace.
 * Suppressed inside code blocks, frontmatter, URLs, and wikilinks.
 */

// ── Helpers ──

function todayStr(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isInsideSuppressedContext(context: CompletionContext): boolean {
  const pos = context.pos;
  const tree = syntaxTree(context.state);
  let suppressed = false;
  tree.iterate({
    from: pos,
    to: pos,
    enter(node) {
      const name = node.name;
      if (
        name === "FencedCode" || name === "CodeBlock" || name === "InlineCode" ||
        name === "CodeMark" || name === "CodeText" ||
        name === "URL" || name === "LinkMark"
      ) {
        suppressed = true;
        return false;
      }
    },
  });
  if (suppressed) return true;

  // Check frontmatter (lines 1..fmEnd)
  const doc = context.state.doc;
  if (doc.line(1).text.trim() === "---") {
    const lineNum = doc.lineAt(pos).number;
    for (let j = 2; j <= doc.lines; j++) {
      if (doc.line(j).text.trim() === "---") {
        if (lineNum <= j) return true;
        break;
      }
    }
  }

  // Check wikilinks: scan back for [[ without ]]
  const line = doc.lineAt(pos);
  const textBefore = line.text.slice(0, pos - line.from);
  const lastOpen = textBefore.lastIndexOf("[[");
  if (lastOpen !== -1) {
    const lastClose = textBefore.lastIndexOf("]]", textBefore.length);
    if (lastClose < lastOpen) return true;
  }

  return false;
}

// ── Static slash command definitions ──

interface SlashCommand {
  label: string;
  detail: string;
  apply: string | ((view: EditorView, completion: Completion, from: number, to: number) => void);
}

// ── Checkbox slash commands ──

const CHECKBOX_RE = /^(\s*[-*+]\s)\[(.)\]/;

function checkboxCommand(marker: string, label: string, detail: string): SlashCommand {
  return {
    label,
    detail,
    apply: (view, _completion, from, to) => {
      const line = view.state.doc.lineAt(from);
      const match = line.text.match(CHECKBOX_RE);
      if (match) {
        // Replace existing checkbox marker
        const markerPos = line.from + match[1].length + 1; // position of the char inside [ ]
        view.dispatch({
          changes: [
            { from, to, insert: "" },            // remove slash command text
            { from: markerPos, to: markerPos + 1, insert: marker },
          ],
        });
      } else {
        // No checkbox on this line — insert one
        view.dispatch({
          changes: { from, to, insert: `- [${marker}] ` },
          selection: EditorSelection.cursor(from + 6),
        });
      }
    },
  };
}

const STATIC_COMMANDS: SlashCommand[] = [
  {
    label: "table",
    detail: "Insert table",
    apply: (view, _completion, from, to) => {
      const table = "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |";
      view.dispatch({
        changes: { from, to, insert: table },
        selection: EditorSelection.cursor(from + 2),
      });
    },
  },
  {
    label: "code",
    detail: "Insert code block",
    apply: (view, _completion, from, to) => {
      const block = "```\n\n```";
      view.dispatch({
        changes: { from, to, insert: block },
        selection: EditorSelection.cursor(from + 4),
      });
    },
  },
  {
    label: "callout",
    detail: "Insert callout",
    apply: (view, _completion, from, to) => {
      const callout = "> [!note]\n> ";
      view.dispatch({
        changes: { from, to, insert: callout },
        selection: EditorSelection.cursor(from + callout.length),
      });
    },
  },
  {
    label: "today",
    detail: "Insert link to today's note",
    apply: (view, _completion, from, to) => {
      const link = `[[${todayStr()}]]`;
      view.dispatch({ changes: { from, to, insert: link } });
    },
  },
  {
    label: "tomorrow",
    detail: "Insert link to tomorrow's note",
    apply: (view, _completion, from, to) => {
      const link = `[[${todayStr(1)}]]`;
      view.dispatch({ changes: { from, to, insert: link } });
    },
  },
  {
    label: "yesterday",
    detail: "Insert link to yesterday's note",
    apply: (view, _completion, from, to) => {
      const link = `[[${todayStr(-1)}]]`;
      view.dispatch({ changes: { from, to, insert: link } });
    },
  },
  checkboxCommand(">", ">", "Forwarded / migrated"),
  checkboxCommand("<", "<", "Scheduled / deferred"),
  checkboxCommand("/", "/", "In progress"),
  checkboxCommand("-", "-", "Cancelled"),
  checkboxCommand("!", "!", "Important"),
];

// ── Template commands (fetched from Rust) ──

interface TemplateEntry {
  name: string;
  content: string;
}

async function getTemplateCommands(): Promise<SlashCommand[]> {
  try {
    const templates = await invoke<TemplateEntry[]>("list_templates");
    return templates.map((t) => ({
      label: `template: ${t.name}`,
      detail: "Insert template",
      apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
        view.dispatch({
          changes: { from, to, insert: t.content },
        });
      },
    }));
  } catch {
    return [];
  }
}

// ── Completion source ──

export async function slashCommandCompletion(
  context: CompletionContext
): Promise<CompletionResult | null> {
  // Match / at start of line or after whitespace
  const match = context.matchBefore(/(?:^|(?<=\s))\/[\w><!/-]*/);
  if (!match) return null;

  if (isInsideSuppressedContext(context)) return null;

  const templateCommands = await getTemplateCommands();
  const allCommands = [...STATIC_COMMANDS, ...templateCommands];

  return {
    from: match.from,
    options: allCommands.map((cmd) => ({
      label: "/" + cmd.label,
      detail: cmd.detail,
      type: "text",
      apply: cmd.apply,
      boost: cmd.label.startsWith("template") ? 0 : 1,
    })),
    filter: true,
  };
}
