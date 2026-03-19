/**
 * Inline SVG icon renderer for CM6 widgets (callouts, alt checkboxes).
 *
 * Stores compact path data and builds SVG strings on demand.
 * Pipe-delimited segments:
 *   plain path   →  <path d="…"/>                    (stroke, no fill)
 *   f:path       →  <path d="…" fill stroke=none/>   (filled shape)
 *   ;;circle:    →  <circle/> (stroke only)
 *   ;;fcircle:   →  <circle/> (filled, no stroke)
 *   ;;rect:      →  <rect/>   (stroke only)
 */

const ICON_PATHS: Record<string, string> = {
  // ── Checkbox mini-icons (optimised for 10px in a 14px box) ──
  "cb-check": "M7 13l3 3 7-8",
  "cb-slash": "M9 17L15 7",
  "cb-minus": "M7 12h10",
  "cb-right": "M10 7l5 5-5 5",
  "cb-left":  "M14 7l-5 5 5 5",
  "cb-bang":  "M12 5v9|;;circle:12,18,1",

  // ── Extras: editorial marginalia (custom glyphs, 13px bare) ──

  // ? — floating question mark: hook + filled dot
  "x-question": "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3|;;fcircle:12,17.5,1.2",

  // * — four-point sparkle (filled)
  "x-star": "f:M12 3l1.5 6.5L20 12l-6.5 1.5L12 21l-1.5-6.5L4 12l6.5-1.5z",

  // " — double comma-quotes: filled dots + slanted tails
  "x-quote": ";;fcircle:8,7,2.5|M8 9.5l-1.5 5|;;fcircle:16,7,2.5|M16 9.5l-1.5 5",

  // l — filled teardrop pin
  "x-location": "f:M12 20c-3-4-6-7-6-10a6 6 0 0 1 12 0c0 3-3 6-6 10z",

  // b — filled ribbon with V-notch
  "x-bookmark": "f:M6 3h12v18l-6-4-6 4z",

  // i — floating info glyph: filled dot + stroked stem
  "x-info": ";;fcircle:12,7,1.5|M12 11v7",

  // S — filled gem/diamond
  "x-savings": "f:M12 3l9 9-9 9-9-9z",

  // I — radiant dot: filled center + four rays
  "x-idea": ";;fcircle:12,12,3|M12 3v4|M12 17v4|M3 12h4|M17 12h4",

  // p — filled plus cross
  "x-pros": "f:M10.5 4h3v6.5H20v3h-6.5V20h-3v-6.5H4v-3h6.5z",

  // c — filled minus bar
  "x-cons": "f:M4 10.5h16v3H4z",

  // f — filled flame silhouette
  "x-fire": "f:M12 2c2 5 6 7 6 12a6 6 0 0 1-12 0c0-5 4-7 6-12z",

  // k — filled bow + stroked shaft & teeth
  "x-key": ";;fcircle:7.5,7.5,4|M11 11l9 9|M16 20h4|M20 16v4",

  // w — filled cup + stroked stem & base
  "x-win": "f:M7 4h10v5a5 5 0 0 1-10 0z|M12 14v3|M8 19h8",

  // u — filled upward triangle
  "x-up": "f:M12 4l8 16H4z",

  // d — filled downward triangle
  "x-down": "f:M4 4h16L12 20z",

  // n — filled head + stroked rim & shaft
  "x-pin": ";;fcircle:12,8,5|M8 13h8|M12 13v8",

  // ── Callout & general icons ──
  "pencil": "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z|M15 5l4 4",
  "clipboard-list": "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2|M12 11h4|M12 16h4|M8 11h.01|M8 16h.01;;rect:8,2,8,4,1,1",
  "info": ";;circle:12,12,10|M12 16v-4|M12 8h.01",
  "check-circle": ";;circle:12,12,10|M9 12l2 2 4-4",
  "flame": "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  "lightbulb": "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5|M9 18h6|M10 22h4",
  "check": "M20 6L9 17l-5-5",
  "help-circle": ";;circle:12,12,10|M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3|M12 17h.01",
  "alert-triangle": "M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3|M12 9v4|M12 17h.01",
  "x": "M18 6L6 18|M6 6l12 12",
  "zap": "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  "bug": "M8 2l1.88 1.88|M14.12 3.88L16 2|M9 7.13v-1a3.003 3.003 0 1 1 6 0v1|M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6|M12 20v-9|M6.53 9C4.6 8.8 3 7.1 3 5|M6 13H2|M3 21c0-2.1 1.7-3.9 3.8-4|M20.97 5c0 2.1-1.6 3.8-3.5 4|M22 13h-4|M17.2 17c2.1.1 3.8 1.9 3.8 4",
  "list": "M3 12h.01|M3 18h.01|M3 6h.01|M8 12h13|M8 18h13|M8 6h13",
  "quote": "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z|M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
  "message-circle": "M7.9 20A9 9 0 1 0 4 16.1L2 22Z",
  "chevron-right": "M9 18l6-6-6-6",
};

export function iconSvg(name: string, size: number, strokeWidth = 2): string {
  const raw = ICON_PATHS[name] || ICON_PATHS["message-circle"];
  let inner = "";
  for (const segment of raw.split("|")) {
    if (segment.startsWith("f:")) {
      // Filled path — solid shape, no stroke
      inner += `<path d="${segment.slice(2)}" fill="currentColor" stroke="none"/>`;
    } else if (segment.startsWith(";;fcircle:")) {
      const [cx, cy, r] = segment.slice(10).split(",");
      inner += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
    } else if (segment.startsWith(";;circle:")) {
      const [cx, cy, r] = segment.slice(9).split(",");
      inner += `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
    } else if (segment.startsWith(";;rect:")) {
      const [x, y, w, h, rx, ry] = segment.slice(7).split(",");
      inner += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${ry}"/>`;
    } else if (segment.startsWith(";;")) {
      continue;
    } else {
      inner += `<path d="${segment}"/>`;
    }
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
