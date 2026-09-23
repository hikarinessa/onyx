/**
 * Images referenced from notes: `![[photo.png]]`, `![[photo.png|300]]`,
 * `![alt](pics/photo.png)`, `![alt|300](https://…)`.
 *
 * Local references resolve in Rust (`resolve_attachment`: folder path, the note's own
 * folder, then the file name anywhere in the registered folders) and load through the
 * asset protocol. Web images load directly. An element fills in its own source once
 * resolved, so the same element works inline in the editor and inside table cells.
 */
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const IMAGE_EXT = "png|jpe?g|gif|webp|svg|avif|bmp|heic";

/** `![[name.ext]]` or `![[name.ext|size-or-alt]]`. Groups: 1 reference, 2 option. */
export const WIKI_IMAGE_RE = new RegExp(`!\\[\\[([^\\]|]+?\\.(?:${IMAGE_EXT}))(?:\\|([^\\]]*))?\\]\\]`, "gi");

/** `![alt](url)`, url optionally in `<…>` or followed by a "title". Groups: 1 alt, 2 url. */
export const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

export const isImageName = (name: string): boolean => new RegExp(`\\.(?:${IMAGE_EXT})$`, "i").test(name.trim());

export interface ImageSize {
  width?: number;
  height?: number;
}

/** `300` or `300x200`, as Obsidian writes image sizes; anything else is not a size. */
export function parseSize(option: string | undefined): ImageSize | null {
  const m = option?.trim().match(/^(\d+)(?:x(\d+))?$/);
  return m ? { width: Number(m[1]), height: m[2] ? Number(m[2]) : undefined } : null;
}

/** An alt text of `caption|300` carries a size after the bar, as in Obsidian. */
export function splitAlt(alt: string): { alt: string; size: ImageSize | null } {
  const bar = alt.lastIndexOf("|");
  const size = bar >= 0 ? parseSize(alt.slice(bar + 1)) : null;
  return size ? { alt: alt.slice(0, bar), size } : { alt, size: null };
}

const resolved = new Map<string, Promise<string | null>>();
/** Results already in, so a new element can take its src without waiting a tick. */
const settled = new Map<string, string | null>();
/** Natural sizes of images seen, by src, so a new element reserves its space at once. */
const naturalSizes = new Map<string, { width: number; height: number }>();
const MISS_TTL_MS = 5000;

/** Loadable src for a reference written in `contextPath`, or null if nothing matches. */
export function resolveImageSrc(reference: string, contextPath: string): Promise<string | null> {
  if (/^(https?:|data:)/i.test(reference)) return Promise.resolve(reference);
  const key = `${contextPath}\u0000${reference}`;
  let pending = resolved.get(key);
  if (!pending) {
    let decoded = reference;
    try {
      decoded = decodeURI(reference);
    } catch {
      // keep it as written
    }
    pending = invoke<string | null>("resolve_attachment", { reference: decoded, contextPath })
      .then((path) => (path ? convertFileSrc(path) : null))
      .catch(() => null);
    resolved.set(key, pending);
    pending.then((src) => {
      settled.set(key, src);
      // A miss is retried later: the image may be added or synced in after this
      if (src === null) {
        setTimeout(() => {
          resolved.delete(key);
          settled.delete(key);
        }, MISS_TTL_MS);
      }
    });
  }
  return pending;
}

/**
 * An `<img>` wrapper that resolves and loads itself. `onSettled` runs once the image has
 * loaded or failed, so an editor can re-measure the line it changed the height of.
 */
export function createImageElement(
  reference: string,
  contextPath: string,
  alt: string,
  size: ImageSize | null,
  onSettled?: () => void,
): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "cm-image-embed";
  const img = document.createElement("img");
  img.alt = alt;
  if (size?.width) img.style.width = `${size.width}px`;
  if (size?.height) img.style.height = `${size.height}px`;
  wrap.appendChild(img);

  // Give the element its final shape before it loads, from the size seen last time, so
  // the line never collapses to zero height and back (which reads as a blink and moves
  // the scroll position).
  const reserve = (src: string) => {
    const known = naturalSizes.get(src);
    if (known) {
      img.width = known.width;
      img.height = known.height;
    }
  };
  img.addEventListener("load", () => {
    if (img.naturalWidth) naturalSizes.set(img.src, { width: img.naturalWidth, height: img.naturalHeight });
  }, { once: true });

  const fail = (reason: string) => {
    wrap.classList.add("cm-image-embed-missing");
    wrap.textContent = `${reason}: ${reference}`;
    onSettled?.();
  };
  img.addEventListener("load", () => onSettled?.(), { once: true });
  img.addEventListener("error", () => fail("Image failed to load"), { once: true });

  const show = (src: string | null) => {
    if (!src) return fail("Image not found");
    reserve(src);
    img.src = src;
  };
  const key = `${contextPath}\u0000${reference}`;
  if (/^(https?:|data:)/i.test(reference)) show(reference);
  else if (settled.has(key)) show(settled.get(key) ?? null);
  else resolveImageSrc(reference, contextPath).then(show);
  return wrap;
}
