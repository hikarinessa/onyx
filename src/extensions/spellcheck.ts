import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { invoke } from "@tauri-apps/api/core";
import { isSpellcheckEnabled } from "../lib/configBridge";

/**
 * Custom spellcheck using macOS NSSpellChecker via Tauri IPC.
 * WebKit's native spellcheck doesn't render underlines in CM6 because
 * CM6's constant DOM manipulation confuses the browser's spell checker.
 *
 * Architecture:
 * - ViewPlugin debounces doc changes and calls Rust `check_spelling` command
 * - Results dispatched as StateEffect to a StateField that holds decorations
 * - Non-prose regions (frontmatter, code blocks, inline code, wikilinks) are filtered
 */

interface SpellingError {
  from: number;
  to: number;
  word: string;
}

// ── State effect & field for async decoration updates ──

const setSpellingErrors = StateEffect.define<SpellingError[]>();

const spellingField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    // Map existing decorations through document changes
    decos = decos.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setSpellingErrors)) {
        const builder = new RangeSetBuilder<Decoration>();
        const mark = Decoration.mark({ class: "cm-spelling-error" });
        // Errors are pre-sorted by `from` position
        for (const err of effect.value) {
          if (err.from < tr.state.doc.length && err.to <= tr.state.doc.length) {
            builder.add(err.from, err.to, mark);
          }
        }
        decos = builder.finish();
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Non-prose region detection ──

/** Returns a Set of line numbers that are inside frontmatter or code blocks */
function getNonProseLines(doc: { lines: number; line(n: number): { text: string } }): Set<number> {
  const skip = new Set<number>();

  // Frontmatter
  if (doc.lines >= 2 && doc.line(1).text.trim() === "---") {
    skip.add(1);
    for (let i = 2; i <= doc.lines; i++) {
      skip.add(i);
      if (doc.line(i).text.trim() === "---") break;
    }
  }

  // Code blocks
  let inCode = false;
  for (let i = 1; i <= doc.lines; i++) {
    if (doc.line(i).text.trimStart().startsWith("```")) {
      inCode = !inCode;
      skip.add(i);
    } else if (inCode) {
      skip.add(i);
    }
  }

  return skip;
}

/** Check if a byte offset falls inside inline code or wikilinks on its line */
function isInlineNonProse(lineText: string, offsetInLine: number): boolean {
  // Inline code: `...`
  let inCode = false;
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] === "`") inCode = !inCode;
    if (i === offsetInLine && inCode) return true;
  }
  // Wikilinks: [[...]]
  const wlRe = /\[\[[^\]]*\]\]/g;
  let m;
  while ((m = wlRe.exec(lineText)) !== null) {
    if (offsetInLine >= m.index && offsetInLine < m.index + m[0].length) return true;
  }
  return false;
}

// ── ViewPlugin: debounced IPC ──

const DEBOUNCE_MS = 800;

const spellcheckPlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private generation = 0;

    constructor(view: EditorView) {
      this.scheduleCheck(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.scheduleCheck(update.view);
      }
    }

    scheduleCheck(view: EditorView) {
      clearTimeout(this.timer);

      if (!isSpellcheckEnabled()) {
        // Clear any existing decorations
        view.dispatch({ effects: setSpellingErrors.of([]) });
        return;
      }

      const gen = ++this.generation;

      this.timer = setTimeout(async () => {
        try {
          const text = view.state.doc.toString();
          const rawErrors = await invoke<SpellingError[]>("check_spelling", { text });

          // Stale? Doc changed while we were waiting
          if (this.generation !== gen) return;

          // Filter out errors in non-prose regions
          const doc = view.state.doc;
          const skipLines = getNonProseLines(doc);
          const filtered: SpellingError[] = [];

          for (const err of rawErrors) {
            if (err.from >= doc.length || err.to > doc.length) continue;
            const line = doc.lineAt(err.from);
            if (skipLines.has(line.number)) continue;
            const offsetInLine = err.from - line.from;
            if (isInlineNonProse(line.text, offsetInLine)) continue;
            filtered.push(err);
          }

          // Dispatch to StateField
          view.dispatch({ effects: setSpellingErrors.of(filtered) });
        } catch (err) {
          // Silently fail — spellcheck is non-critical
          console.warn("Spellcheck failed:", err);
        }
      }, DEBOUNCE_MS);
    }

    destroy() {
      clearTimeout(this.timer);
    }
  }
);

// ── Theme ──

const spellcheckTheme = EditorView.theme({
  ".cm-spelling-error": {
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='3'%3E%3Cpath d='M0 2.5 Q1 0.5 2 2.5 Q3 4.5 4 2.5' fill='none' stroke='%23e85454' stroke-width='0.7'/%3E%3C/svg%3E\")",
    backgroundRepeat: "repeat-x",
    backgroundPosition: "bottom",
    backgroundSize: "4px 3px",
    paddingBottom: "1px",
  },
});

// ── Export ──

export function spellcheckExtension(): Extension[] {
  return [spellingField, spellcheckPlugin, spellcheckTheme];
}
