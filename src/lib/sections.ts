/**
 * Link subpaths: `note#Heading`, `note#Heading#Subheading` and `note#^block-id`.
 * Obsidian embeds and canvas file nodes point at part of a note this way.
 */

/** Split a link into the note it names and its subpath (without the leading `#`). */
export function splitSubpath(link: string): { target: string; subpath: string | null } {
  const hash = link.indexOf("#");
  if (hash < 0) return { target: link, subpath: null };
  const subpath = link.slice(hash + 1).trim();
  return { target: link.slice(0, hash), subpath: subpath || null };
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The part of `content` a subpath names, or null when it names nothing.
 *
 * - A heading subpath returns the heading line and everything under it, up to the next
 *   heading of the same or a higher level. With several segments (`A#B`), each is looked
 *   for inside the previous one's section, and the last one is returned.
 * - A block subpath (`^id`) returns the paragraph or list item that ends with ` ^id`.
 *
 * Headings inside fenced code blocks are not headings.
 */
export function extractSection(content: string, subpath: string): string | null {
  const lines = content.split("\n");
  const trimmed = subpath.replace(/^#/, "");
  if (trimmed.startsWith("^")) return extractBlock(lines, trimmed.slice(1));

  let from = 0;
  let to = lines.length;
  for (const segment of trimmed.split("#").map(normalise).filter(Boolean)) {
    const found = findHeading(lines, from, to, segment);
    if (!found) return null;
    [from, to] = found;
  }
  return lines.slice(from, to).join("\n").replace(/\n+$/, "");
}

function findHeading(lines: string[], from: number, to: number, name: string): [number, number] | null {
  let inFence = false;
  for (let i = from; i < to; i++) {
    if (FENCE_RE.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = lines[i].match(HEADING_RE);
    if (!m || normalise(m[2]) !== name) continue;
    const level = m[1].length;
    let end = to;
    let fence = false;
    for (let j = i + 1; j < to; j++) {
      if (FENCE_RE.test(lines[j])) { fence = !fence; continue; }
      if (fence) continue;
      const h = lines[j].match(HEADING_RE);
      if (h && h[1].length <= level) { end = j; break; }
    }
    return [i, end];
  }
  return null;
}

function extractBlock(lines: string[], id: string): string | null {
  const marker = new RegExp(`\\s\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  const at = lines.findIndex((l) => marker.test(l));
  if (at < 0) return null;
  // A list item stands alone; a paragraph runs back to the previous blank line
  if (/^\s*([-*+]|\d+\.)\s/.test(lines[at])) return lines[at].replace(marker, "");
  let start = at;
  while (start > 0 && lines[start - 1].trim() !== "") start--;
  return lines.slice(start, at + 1).join("\n").replace(marker, "");
}
