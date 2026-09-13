/**
 * Footnote parsing.
 *
 * Syntax (GFM / Pandoc):
 *   Text with a reference.[^label]
 *
 *   [^label]: The definition, on a line of its own.
 *   	Indented lines continue it, across blank lines too.
 *
 * Labels match case-insensitively. A label is numbered in the order it is first
 * referenced, and only once it has a definition: a reference to nothing, or a definition
 * nothing refers to, stays literal text, so a stray `[^x]` in prose is never rendered as a
 * footnote that leads nowhere. The first definition of a label wins.
 *
 * Code is not prose: frontmatter, fenced code blocks and inline code spans are skipped.
 * Every offset indexes into the full document.
 */

export interface Span {
  from: number;
  to: number;
}

export interface FootnoteDefinition {
  label: string;
  /** Number shown for this footnote; 0 when nothing references it. */
  number: number;
  /** The `[^label]:` marker at the start of the line. */
  marker: Span;
  /** From the first character after the marker to the end of the last continuation line. */
  body: Span;
  /** Body text with continuation indentation removed, for display. */
  text: string;
}

export interface FootnoteReference {
  label: string;
  /** Number shown for this reference; 0 when the label has no definition. */
  number: number;
  /** The whole `[^label]` token. */
  token: Span;
}

export interface Footnotes {
  references: FootnoteReference[];
  /** In document order. Duplicate labels after the first are not included. */
  definitions: FootnoteDefinition[];
}

export const EMPTY_FOOTNOTES: Footnotes = { references: [], definitions: [] };

/** Cheap pre-check: a document without `[^` cannot contain a footnote. */
export const hasFootnotes = (doc: string): boolean => doc.includes("[^");

const DEFINITION_RE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?/;
const REFERENCE_RE = /(?<!\\)\[\^([^\]\s]+)\]/g;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE_RE = /(`+)[^`]+?\1/g;
const CONTINUATION_RE = /^(\t| {2,})/;

const normalize = (label: string) => label.toLowerCase();

interface Line {
  from: number;
  text: string;
}

function splitLines(doc: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (const text of doc.split("\n")) {
    lines.push({ from, text });
    from += text.length + 1;
  }
  return lines;
}

/** Index of the first line after YAML frontmatter, or 0 when there is none. */
function frontmatterEnd(lines: Line[]): number {
  if (lines.length === 0 || lines[0].text.trimEnd() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].text.trimEnd();
    if (t === "---" || t === "...") return i + 1;
  }
  return 0;
}

const dedent = (text: string) => text.replace(/^(\t| {1,4})/, "");

export function parseFootnotes(doc: string): Footnotes {
  if (!hasFootnotes(doc)) return EMPTY_FOOTNOTES;

  const lines = splitLines(doc);
  const rawRefs: { label: string; token: Span }[] = [];
  const defs: Omit<FootnoteDefinition, "number">[] = [];
  const seenDefs = new Set<string>();

  let fence: string | null = null;
  let i = frontmatterEnd(lines);

  const scanReferences = (line: Line, start: number) => {
    const text = line.text;
    const code: Span[] = [];
    INLINE_CODE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_CODE_RE.exec(text)) !== null) {
      code.push({ from: m.index, to: m.index + m[0].length });
    }
    REFERENCE_RE.lastIndex = start;
    while ((m = REFERENCE_RE.exec(text)) !== null) {
      const at = m.index;
      if (code.some((c) => at >= c.from && at < c.to)) continue;
      rawRefs.push({
        label: normalize(m[1]),
        token: { from: line.from + at, to: line.from + at + m[0].length },
      });
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    const fenceMatch = line.text.match(FENCE_RE);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      i++;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      i++;
      continue;
    }

    const defMatch = line.text.match(DEFINITION_RE);
    if (!defMatch) {
      scanReferences(line, 0);
      i++;
      continue;
    }

    // A definition: its first line, then indented continuation lines. Blank lines belong
    // to it only when an indented line follows them.
    const markerLen = defMatch[0].trimEnd().length;
    const bodyFrom = line.from + defMatch[0].length;
    const textParts = [line.text.slice(defMatch[0].length)];
    scanReferences(line, defMatch[0].length);

    let last = i;
    let j = i + 1;
    while (j < lines.length) {
      if (CONTINUATION_RE.test(lines[j].text)) {
        for (let k = last + 1; k < j; k++) textParts.push("");
        textParts.push(dedent(lines[j].text));
        scanReferences(lines[j], 0);
        last = j;
        j++;
      } else if (lines[j].text.trim() === "") {
        j++;
      } else {
        break;
      }
    }

    const label = normalize(defMatch[1]);
    if (!seenDefs.has(label)) {
      seenDefs.add(label);
      defs.push({
        label,
        marker: { from: line.from + defMatch[0].indexOf("["), to: line.from + markerLen },
        body: { from: bodyFrom, to: lines[last].from + lines[last].text.length },
        text: textParts.join("\n").trim(),
      });
    }
    i = last + 1;
  }

  const numbers = new Map<string, number>();
  for (const r of rawRefs) {
    if (seenDefs.has(r.label) && !numbers.has(r.label)) numbers.set(r.label, numbers.size + 1);
  }

  return {
    references: rawRefs.map((r) => ({ ...r, number: numbers.get(r.label) ?? 0 })),
    definitions: defs.map((d) => ({ ...d, number: numbers.get(d.label) ?? 0 })),
  };
}
