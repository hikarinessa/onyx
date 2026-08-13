/**
 * CriticMarkup parsing and decision operations.
 *
 * Onyx keeps annotations in the note itself, so every offset here indexes into the
 * live document — markers included. That differs from a review tool that strips the
 * markup into a separate source: here the document is the state, a suggestion exists
 * only while its markup is on disk, and deciding one is an ordinary edit that removes
 * it. There is no accepted/rejected status to track, because a decided suggestion is
 * no longer in the document to have one.
 *
 * Syntax:
 *   {--text--}              delete text
 *   {++text++}              insert text
 *   {~~old~>new~~}          replace old with new
 *   {==text==}{>>comment<<} comment anchored to text
 *   {>>comment<<}           point comment
 */

export type SuggestionType = "deletion" | "addition" | "substitution" | "comment";

export interface Span {
  from: number;
  to: number;
}

export interface Suggestion {
  id: string;
  type: SuggestionType;
  /** The whole construct including markers — the span a decision replaces. */
  token: Span;
  /** Existing document text under the suggestion. Empty span for additions and point comments. */
  original: Span;
  /** Proposed text (addition, substitution). Null for deletions and comments. */
  replacement: Span | null;
  /** Comment body. Null for edits. Empty span for a bare highlight. */
  comment: Span | null;
  /** From a `{>>@name: ...<<}` tag. Undefined means untagged, treated as the LLM layer. */
  author?: string;
}

export interface ParseWarning {
  message: string;
  line: number;
}

export interface ParseResult {
  suggestions: Suggestion[];
  warnings: ParseWarning[];
}

// One alternation tried in order at each position. The highlight+comment pair must come
// before the standalone forms so an anchored comment binds as a single suggestion.
const TOKEN = new RegExp(
  [
    "\\{--([\\s\\S]*?)--\\}", // 1: deletion
    "\\{\\+\\+([\\s\\S]*?)\\+\\+\\}", // 2: addition
    "\\{~~([\\s\\S]*?)~>([\\s\\S]*?)~~\\}", // 3,4: substitution
    "\\{==([\\s\\S]*?)==\\}\\{>>([\\s\\S]*?)<<\\}", // 5,6: highlight + anchored comment
    "\\{==([\\s\\S]*?)==\\}", // 7: bare highlight
    "\\{>>([\\s\\S]*?)<<\\}", // 8: point comment
  ].join("|"),
  "g",
);

const STRAY = /\{--|--\}|\{\+\+|\+\+\}|\{~~|~~\}|\{==|==\}|\{>>|<<\}/g;

const OPENERS = ["{--", "{++", "{~~", "{==", "{>>"];

/**
 * Cheap check for whether a document is worth parsing. Most notes carry no annotations,
 * and this keeps the regex scan off the hot path for all of them.
 */
export const hasCriticMarkup = (text: string): boolean =>
  OPENERS.some((m) => text.includes(m));

const AUTHOR = /^@([A-Za-z0-9_-]+):\s*/;

/** Marker widths, so inner spans can be derived from a match offset. */
const OPEN = 3;
const CLOSE = 3;
const SUB_SEP = 2; // ~>
const HL_TO_COMMENT = 6; // ==}{>>

function splitAuthor(raw: string, at: number): { author?: string; body: Span } {
  const m = AUTHOR.exec(raw);
  return m
    ? { author: m[1], body: { from: at + m[0].length, to: at + raw.length } }
    : { body: { from: at, to: at + raw.length } };
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === "\n") line++;
  return line;
}

const point = (at: number): Span => ({ from: at, to: at });

/**
 * Find every CriticMarkup construct in a document. Offsets index into `doc` itself,
 * so they can be handed straight to CodeMirror as decoration ranges or change specs.
 */
export function parseCriticMarkup(doc: string): ParseResult {
  const suggestions: Suggestion[] = [];
  const covered: Span[] = [];
  let n = 0;

  for (const m of doc.matchAll(TOKEN)) {
    const start = m.index;
    const end = start + m[0].length;
    const token: Span = { from: start, to: end };
    // The substitution's replacement half is derived from offsets, not its capture group.
    const [del, add, subOld, , hlText, hlComment, hlOnly, pointComment] = m.slice(1);
    const id = `cm${++n}`;
    covered.push(token);

    if (del !== undefined) {
      suggestions.push({
        id,
        type: "deletion",
        token,
        original: { from: start + OPEN, to: end - CLOSE },
        replacement: null,
        comment: null,
      });
    } else if (add !== undefined) {
      suggestions.push({
        id,
        type: "addition",
        token,
        original: point(start),
        replacement: { from: start + OPEN, to: end - CLOSE },
        comment: null,
      });
    } else if (subOld !== undefined) {
      const oldFrom = start + OPEN;
      const oldTo = oldFrom + subOld.length;
      suggestions.push({
        id,
        type: "substitution",
        token,
        original: { from: oldFrom, to: oldTo },
        replacement: { from: oldTo + SUB_SEP, to: end - CLOSE },
        comment: null,
      });
    } else if (hlText !== undefined) {
      const hlFrom = start + OPEN;
      const hlTo = hlFrom + hlText.length;
      const { author, body } = splitAuthor(hlComment ?? "", hlTo + HL_TO_COMMENT);
      suggestions.push({
        id,
        type: "comment",
        token,
        original: { from: hlFrom, to: hlTo },
        replacement: null,
        comment: body,
        author,
      });
    } else if (hlOnly !== undefined) {
      const hlFrom = start + OPEN;
      suggestions.push({
        id,
        type: "comment",
        token,
        original: { from: hlFrom, to: hlFrom + hlOnly.length },
        replacement: null,
        comment: point(end - CLOSE),
      });
    } else if (pointComment !== undefined) {
      const { author, body } = splitAuthor(pointComment, start + OPEN);
      suggestions.push({
        id,
        type: "comment",
        token,
        original: point(start),
        replacement: null,
        comment: body,
        author,
      });
    }
  }

  // A marker outside any recognised construct means malformed markup. Surfacing it is
  // the difference between "no suggestions here" and "suggestions we failed to read".
  const warnings: ParseWarning[] = [];
  const inside = (i: number) => covered.some((c) => i >= c.from && i < c.to);
  for (const m of doc.matchAll(STRAY)) {
    if (inside(m.index)) continue;
    warnings.push({
      message: `Stray CriticMarkup marker "${m[0]}" — the annotation is malformed and was left as plain text`,
      line: lineAt(doc, m.index),
    });
  }

  return { suggestions, warnings };
}

const EDIT_TYPES = new Set<SuggestionType>(["deletion", "addition", "substitution"]);

export const isEdit = (s: Suggestion): boolean => EDIT_TYPES.has(s.type);

/**
 * Point comments by the LLM sitting flush against an edit are that edit's rationale —
 * they explain it rather than standing alone, so they render inside its card and are
 * consumed by its decision. Anchored comments and `@user` comments never attach.
 */
export function attachedRationales(suggestions: Suggestion[]): Map<string, Suggestion[]> {
  const map = new Map<string, Suggestion[]>();
  for (let i = 0; i < suggestions.length; i++) {
    const edit = suggestions[i];
    if (!isEdit(edit)) continue;
    const chain: Suggestion[] = [];
    let anchor = edit.token.to;
    for (let j = i + 1; j < suggestions.length; j++) {
      const c = suggestions[j];
      const attachable =
        c.type === "comment" &&
        c.original.from === c.original.to && // point comment, not anchored
        c.token.from === anchor &&
        (c.author === undefined || c.author === "llm");
      if (!attachable) break;
      chain.push(c);
      anchor = c.token.to;
    }
    if (chain.length) map.set(edit.id, chain);
  }
  return map;
}

/** Ids of every comment absorbed as a rationale, so they aren't also listed on their own. */
export function absorbedIds(rationales: Map<string, Suggestion[]>): Set<string> {
  const ids = new Set<string>();
  for (const chain of rationales.values()) for (const c of chain) ids.add(c.id);
  return ids;
}

// ---------------------------------------------------------------------------
// Decisions
//
// Every decision is the same move: replace the whole token with the text that should
// stand in its place. That keeps them non-overlapping, so a batch can be dispatched as
// one transaction, and it puts undo, auto-save and conflict detection on the ordinary
// editing path rather than a parallel one.
// ---------------------------------------------------------------------------

/** Structurally a CodeMirror ChangeSpec, without importing one. */
export interface DocChange {
  from: number;
  to: number;
  insert: string;
}

const slice = (doc: string, s: Span): string => doc.slice(s.from, s.to);

const isBlank = (s: string) => s.trim() === "";

/**
 * A construct sitting alone on its own line — a whole added paragraph, a list item marked
 * for deletion — would leave an empty line behind when its text is removed. Take the line
 * with it, so a decision on a block leaves the document as if the block had never been
 * proposed. Only applies when nothing is left to insert and nothing else shares the line.
 */
function collapseWholeLine(doc: string, change: DocChange): DocChange {
  if (change.insert !== "") return change;
  const lineStart = doc.lastIndexOf("\n", change.from - 1) + 1;
  const nextNewline = doc.indexOf("\n", change.to);
  const lineEnd = nextNewline === -1 ? doc.length : nextNewline;
  if (!isBlank(doc.slice(lineStart, change.from)) || !isBlank(doc.slice(change.to, lineEnd))) {
    return change;
  }
  // Take the line's own terminator, or the preceding one at end of document.
  return nextNewline !== -1
    ? { from: lineStart, to: lineEnd + 1, insert: "" }
    : { from: lineStart === 0 ? 0 : lineStart - 1, to: lineEnd, insert: "" };
}

/**
 * User-authored prose ends up inside `{>>...<<}`, where a stray marker would truncate
 * the comment and silently corrupt everything after it. Neutralise the sequences that
 * could close or open a construct.
 */
function sanitizeNote(text: string): string {
  return text
    .trim()
    .replace(/<<\}/g, "<< }")
    .replace(/\{>>/g, "{ >>")
    .replace(/--\}/g, "-- }")
    .replace(/\+\+\}/g, "++ }")
    .replace(/~~\}/g, "~~ }")
    .replace(/==\}/g, "== }");
}

function rejectionLabel(doc: string, s: Suggestion): string {
  switch (s.type) {
    case "addition":
      return `rejected addition "${slice(doc, s.replacement!)}"`;
    case "deletion":
      return "rejected deletion";
    case "substitution":
      return `rejected change to "${slice(doc, s.replacement!)}"`;
    default:
      return "rejected";
  }
}

/** Take the suggestion: the proposed text stands, the markup goes. */
export function acceptChange(doc: string, s: Suggestion): DocChange {
  const { from, to } = s.token;
  switch (s.type) {
    case "deletion":
      return collapseWholeLine(doc, { from, to, insert: "" });
    case "addition":
    case "substitution":
      return { from, to, insert: slice(doc, s.replacement!) };
    case "comment":
      return dismissChange(doc, s);
  }
}

/**
 * Leave the original text standing. With a note, the decision travels back to the next
 * annotation pass as a `@user` comment; without one it simply disappears.
 */
export function rejectChange(doc: string, s: Suggestion, note?: string): DocChange {
  const { from, to } = s.token;
  const clean = note ? sanitizeNote(note) : "";
  const trailer = clean ? `{>>@user: ${rejectionLabel(doc, s)} — ${clean}<<}` : "";
  return collapseWholeLine(doc, { from, to, insert: slice(doc, s.original) + trailer });
}

/** Drop a comment. The highlighted text stays; a point comment leaves nothing behind. */
export function dismissChange(doc: string, s: Suggestion): DocChange {
  const { from, to } = s.token;
  return collapseWholeLine(doc, { from, to, insert: slice(doc, s.original) });
}

/** Answer a comment in place. Both the original comment and the reply survive to the next pass. */
export function replyChange(s: Suggestion, reply: string): DocChange {
  const clean = sanitizeNote(reply);
  const at = s.token.to;
  return { from: at, to: at, insert: clean ? `{>>@user: ${clean}<<}` : "" };
}

/**
 * Apply non-overlapping changes to a string. CodeMirror does this itself on dispatch;
 * this exists for previews and for tests, which need the result without an editor.
 */
export function applyChanges(doc: string, changes: DocChange[]): string {
  const sorted = [...changes].sort((a, b) => a.from - b.from);
  let out = "";
  let cursor = 0;
  for (const c of sorted) {
    if (c.from < cursor) continue; // overlapping change — first one wins
    out += doc.slice(cursor, c.from) + c.insert;
    cursor = c.to;
  }
  return out + doc.slice(cursor);
}

