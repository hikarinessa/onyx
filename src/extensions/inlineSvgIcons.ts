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

  // ── Extras: 16 semantic markers (13px bare icons) ──

  // ? — clean hook question mark (stroke) + filled dot
  "x-question": "M9 8.5a4 4 0 0 1 7 1.5c0 2.5-3 3.5-3.5 6|;;fcircle:12.5,19,1.5",

  // * — four-point star (filled, bold)
  "x-star": "f:M12 2l2 7 7 2-7 2-2 7-2-7-7-2 7-2z",

  // " — tabler filled double-quotes
  "x-quote": "f:M9 5a2 2 0 0 1 2 2v6c0 3.13-1.65 5.193-4.757 5.97a1 1 0 1 1-.486-1.94c2.227-.557 3.243-1.827 3.243-4.03v-1h-3a2 2 0 0 1-1.995-1.85l-.005-.15v-3a2 2 0 0 1 2-2z|f:M18 5a2 2 0 0 1 2 2v6c0 3.13-1.65 5.193-4.757 5.97a1 1 0 1 1-.486-1.94c2.227-.557 3.243-1.827 3.243-4.03v-1h-3a2 2 0 0 1-1.995-1.85l-.005-.15v-3a2 2 0 0 1 2-2z",

  // l — solid teardrop pin
  "x-location": "f:M12 21c-4-5-7-8.5-7-12a7 7 0 0 1 14 0c0 3.5-3 7-7 12z",

  // b — filled ribbon, wider
  "x-bookmark": "f:M5 2h14v19l-7-4.5-7 4.5z",

  // i — solid info glyph: filled dot + block stem
  "x-info": ";;fcircle:12,5.5,2.2|f:M10 10h4v10h-4z",

  // S — euro symbol (stroke)
  "x-savings": "M18 8c-1.5-2.5-4-4-7-4-4.4 0-8 3.6-8 8s3.6 8 8 8c3 0 5.5-1.5 7-4|M3 10h10|M4 14h8",

  // I — ink radiant: filled centre + 8 rays
  "x-idea": ";;fcircle:12,12,3|M12 3v4|M12 17v4|M3 12h4|M17 12h4|M6.5 6.5l3 3|M14.5 14.5l3 3|M6.5 17.5l3-3|M14.5 9.5l3-3",

  // p — tabler filled thumb-up
  "x-pros": "f:M13 3a3 3 0 0 1 2.995 2.824l.005.176v4h2a3 3 0 0 1 2.98 2.65l.015.174l.005.176l-.02.196l-1.006 5.032c-.381 1.626-1.502 2.796-2.81 2.78l-.164-.008h-8a1 1 0 0 1-.993-.883l-.007-.117l.001-9.536a1 1 0 0 1 .5-.865a2.998 2.998 0 0 0 1.492-2.397l.007-.202v-1a3 3 0 0 1 3-3z|f:M5 10a1 1 0 0 1 .993.883l.007.117v9a1 1 0 0 1-.883.993l-.117.007h-1a2 2 0 0 1-1.995-1.85l-.005-.15v-7a2 2 0 0 1 1.85-1.995l.15-.005h1z",

  // c — tabler filled thumb-down
  "x-cons": "f:M13 21.008a3 3 0 0 0 2.995-2.823l.005-.177v-4h2a3 3 0 0 0 2.98-2.65l.015-.173l.005-.177l-.02-.196l-1.006-5.032c-.381-1.625-1.502-2.796-2.81-2.78l-.164.008h-8a1 1 0 0 0-.993.884l-.007.116l.001 9.536a1 1 0 0 0 .5.866a2.998 2.998 0 0 1 1.492 2.396l.007.202v1a3 3 0 0 0 3 3z|f:M5 14.008a1 1 0 0 0 .993-.883l.007-.117v-9a1 1 0 0 0-.883-.993l-.117-.007h-1a2 2 0 0 0-1.995 1.852l-.005.15v7a2 2 0 0 0 1.85 1.994l.15.005h1z",

  // f — tabler filled flame
  "x-fire": "f:M10 2c0-.88 1.056-1.331 1.692-.722c1.958 1.876 3.096 5.995 1.75 9.12l-.08.174l.012.003c.625.133 1.203-.43 2.303-2.173l.14-.224a1 1 0 0 1 1.582-.153c1.334 1.435 2.601 4.377 2.601 6.27c0 4.265-3.591 7.705-8 7.705s-8-3.44-8-7.706c0-2.252 1.022-4.716 2.632-6.301l.605-.589c.241-.236.434-.43.618-.624c1.43-1.512 2.145-2.924 2.145-4.78",

  // k — remix filled key
  "x-key": "f:M17 14H12.6586C11.8349 16.3304 9.61244 18 7 18C3.68629 18 1 15.3137 1 12C1 8.68629 3.68629 6 7 6C9.61244 6 11.8349 7.66962 12.6586 10H23V14H21V18H17V14ZM7 14C8.10457 14 9 13.1046 9 12C9 10.8954 8.10457 10 7 10C5.89543 10 5 10.8954 5 12C5 13.1046 5.89543 14 7 14Z",

  // w — medal solid (circle + ribbon tails)
  "x-win": "f:M12 1c4.418 0 8 3.582 8 8 0 2.526-1.171 4.776-3 6.245V22l-5-3-5 3v-6.755C5.171 13.776 4 11.526 4 9c0-4.418 3.582-8 8-8z",

  // u — filled upward triangle
  "x-up": "f:M12 4l8 16H4z",

  // d — filled downward triangle
  "x-down": "f:M4 4h16L12 20z",

  // n — remix pushpin (filled)
  "x-pin": "f:M18 3V5H17V11L19 14V16H13V23H11V16H5V14L7 11V5H6V3H18Z",

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
