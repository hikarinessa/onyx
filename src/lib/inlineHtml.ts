/**
 * Inline HTML in notes (mostly imported from Obsidian): coloured text via
 * `<font style="color:…">` / `<span style="color:…">`, `<br>`, `<u>`, `<sup>`, links,
 * and the odd `<p>`. Preview renders an allowlist of it; everything else stays text.
 *
 * Nothing from the note reaches the page as markup. The HTML is parsed into a detached
 * document and rebuilt element by element: only allowed tags survive, and of their
 * attributes only a validated `color`, an http(s)/mailto `href`, and the `font-mono`
 * class. Scripts, styles and embeds are dropped with their content; any other tag is
 * unwrapped to its text.
 */

/** Tags rebuilt as elements. `font` becomes a `span`. */
const ALLOWED = new Set([
  "font", "span", "br", "u", "sup", "sub", "b", "strong", "i", "em", "mark", "s", "del", "small", "a", "p",
]);

/** Tags removed together with everything inside them. */
const DROPPED = new Set(["script", "style", "iframe", "object", "embed", "template", "svg", "math", "noscript"]);

const VOID = new Set(["br"]);

export interface HtmlSegment {
  from: number;
  to: number;
}

const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)\b[^<>]*?(\/?)>/g;

/**
 * Stretches of `text` that are complete allowed HTML: an allowed element whose closing
 * tag is on the same text, outermost only, or a lone `<br>`. Unbalanced tags are left
 * out, so a half-written tag shows as the text it is.
 */
export function findHtmlSegments(text: string): HtmlSegment[] {
  const segments: HtmlSegment[] = [];
  const stack: { name: string; from: number }[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const [whole, closing, rawName, selfClosing] = m;
    const name = rawName.toLowerCase();
    if (!ALLOWED.has(name)) continue;
    const from = m.index;
    const to = from + whole.length;
    if (VOID.has(name) || selfClosing) {
      if (stack.length === 0) segments.push({ from, to });
      continue;
    }
    if (!closing) {
      stack.push({ name, from });
      continue;
    }
    // Close the nearest matching opener; openers left above it were unbalanced
    const at = stack.map((s) => s.name).lastIndexOf(name);
    if (at < 0) continue;
    const opener = stack[at];
    stack.length = at;
    if (stack.length === 0) segments.push({ from: opener.from, to });
  }
  return segments;
}

/** A CSS colour from a `style` attribute, if it is a plain colour value. */
export function safeColor(style: string | null): string | null {
  const m = style?.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  const value = m?.[1].trim();
  if (!value) return null;
  const ok = /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^(rgb|rgba|hsl|hsla|oklch|oklab)\(\s*[\d.,%\s/+-]+\)$/i.test(value) ||
    /^[a-z]+$/i.test(value);
  return ok ? value : null;
}

/** An href that may be opened: http(s) and mailto only. */
export function safeHref(href: string | null): string | null {
  const value = href?.trim();
  return value && /^(https?:|mailto:)/i.test(value) ? value : null;
}

function rebuild(source: Node, target: Node): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const name = el.tagName.toLowerCase();
    if (DROPPED.has(name)) continue;
    if (!ALLOWED.has(name)) {
      rebuild(el, target); // unknown tag: keep its text, lose the tag
      continue;
    }
    const out = document.createElement(name === "font" ? "span" : name);
    const color = safeColor(el.getAttribute("style")) ?? (name === "font" ? safeColor(`color:${el.getAttribute("color") ?? ""}`) : null);
    if (color) out.style.color = color;
    if (el.classList.contains("font-mono")) out.classList.add("cm-html-mono");
    if (name === "a") {
      const href = safeHref(el.getAttribute("href"));
      // The editor's click dispatcher opens [data-url] elements in the browser
      if (href) {
        out.dataset.url = href;
        out.classList.add("cm-preview-url");
      }
    }
    target.appendChild(out);
    if (!VOID.has(name)) rebuild(el, out);
  }
}

/** Safe DOM for an HTML snippet from a note (see the module comment). */
export function renderHtmlSnippet(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const fragment = document.createDocumentFragment();
  rebuild(parsed.body, fragment);
  return fragment;
}
