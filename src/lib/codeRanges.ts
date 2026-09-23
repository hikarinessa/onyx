/**
 * Where a markdown document holds code rather than prose: fenced blocks and inline code
 * spans. Parsers that give meaning to punctuation (CriticMarkup) use this so a note that
 * *describes* the syntax is not read as using it.
 *
 * Indented code blocks are not detected: four-space indentation is also how list items
 * continue, and misreading a list as code would hide real content, which is worse than
 * reading a rare indented example as prose.
 */

export interface Span {
  from: number;
  to: number;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

// A backtick run, its content, and a closing run of the same length. The lookarounds
// stop a run of three from pairing with part of a run of four; a backslash-escaped
// backtick does not open a span.
const INLINE_CODE_RE = /(?<![`\\])(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;

/** Offsets of every code range in `doc`, in document order. */
export function codeRanges(doc: string): Span[] {
  const ranges: Span[] = [];
  let proseFrom = 0;
  let fence: { marker: string; from: number } | null = null;

  let lineFrom = 0;
  for (const text of doc.split("\n")) {
    const lineTo = lineFrom + text.length;
    const m = text.match(FENCE_RE);
    if (fence) {
      const closes = m && m[1][0] === fence.marker[0] && m[1].length >= fence.marker.length &&
        text.trim() === m[1];
      if (closes) {
        ranges.push({ from: fence.from, to: lineTo });
        fence = null;
        proseFrom = lineTo + 1;
      }
    } else if (m && !(m[1][0] === "`" && text.slice(text.indexOf(m[1]) + m[1].length).includes("`"))) {
      // A backtick fence's info string can't contain a backtick (CommonMark), so
      // "```js``` inline" is a code span on a prose line, not an opening fence.
      inlineRanges(doc, proseFrom, lineFrom, ranges);
      fence = { marker: m[1], from: lineFrom };
    }
    lineFrom = lineTo + 1;
  }

  if (fence) ranges.push({ from: fence.from, to: doc.length }); // unclosed: runs to the end
  else inlineRanges(doc, proseFrom, doc.length, ranges);
  return ranges;
}

/** Inline code spans in `doc[from, to)`. A span never crosses a blank line (a paragraph break). */
function inlineRanges(doc: string, from: number, to: number, out: Span[]): void {
  const prose = doc.slice(from, to);
  let paraFrom = 0;
  for (const para of prose.split(/(\n[ \t]*\n)/)) {
    if (!/^\n[ \t]*\n$/.test(para)) {
      for (const m of para.matchAll(INLINE_CODE_RE)) {
        const at = from + paraFrom + m.index;
        out.push({ from: at, to: at + m[0].length });
      }
    }
    paraFrom += para.length;
  }
}

/** Whether `at` falls inside any of `ranges`. */
export const inCode = (ranges: Span[], at: number): boolean =>
  ranges.some((r) => at >= r.from && at < r.to);
