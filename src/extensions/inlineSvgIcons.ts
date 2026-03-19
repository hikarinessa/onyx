/**
 * Inline SVG icon renderer for CM6 widgets (callouts, alt checkboxes).
 *
 * Stores compact Lucide-compatible path data and builds SVG strings on demand.
 * Pipe-delimited segments: plain = <path>, ;;circle:cx,cy,r, ;;rect:x,y,w,h,rx,ry.
 */

const ICON_PATHS: Record<string, string> = {
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
  "star": "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
  "map-pin": "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0|;;circle:12,10,3",
  "bookmark": "M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z",
  "banknote": ";;rect:2,6,20,12,2,2|;;circle:12,12,2|M6 12h.01M18 12h.01",
  "thumbs-up": "M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z|M7 10v12",
  "thumbs-down": "M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z|M17 14V2",
  "key": "M15.5 7.5l2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4|M21 2l-9.6 9.6|;;circle:7.5,15.5,5.5",
  "trophy": "M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978|M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978|M18 9h1.5a1 1 0 0 0 0-5H18|M4 22h16|M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z|M6 9H4.5a1 1 0 0 1 0-5H6",
  "arrow-up": "M5 12l7-7 7 7|M12 19V5",
  "arrow-down": "M12 5v14|M19 12l-7 7-7-7",
  "pin": "M12 17v5|M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
};

export function iconSvg(name: string, size: number): string {
  const raw = ICON_PATHS[name] || ICON_PATHS["message-circle"];
  let inner = "";
  for (const segment of raw.split("|")) {
    if (segment.startsWith(";;circle:")) {
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
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
