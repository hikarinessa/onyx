/**
 * Date display and entry for date properties.
 *
 * Frontmatter always stores ISO `YYYY-MM-DD`. The UI shows and accepts dates in the
 * order of the macOS region (DD/MM/YYYY for Germany, MM/DD/YYYY for the US,
 * YYYY/MM/DD for Japan). The order comes from the OS date pattern the backend reads
 * (`get_region_date_pattern`), because WKWebView reports only the UI language
 * (`en-US`) and drops the region, so `Intl` in the webview formats US-style even
 * when the region is Germany.
 */

export type DateOrder = "DMY" | "MDY" | "YMD";

export const DATE_SEPARATOR = "/";

/** Field order of a Unicode (ICU/NSDateFormatter) date pattern such as `dd.MM.yyyy`. */
export function dateOrderFromPattern(pattern: string): DateOrder | null {
  // Quoted literals ('de', 'г.') can contain pattern letters; drop them first.
  const bare = pattern.replace(/'[^']*'/g, "");
  const d = bare.search(/d/);
  const m = bare.search(/[ML]/);
  const y = bare.search(/[yuU]/);
  if (d < 0 || m < 0 || y < 0) return null;
  return orderFromPositions(d, m, y);
}

/** Field order of `Intl.DateTimeFormat#formatToParts` part types. */
export function dateOrderFromPartTypes(types: readonly string[]): DateOrder | null {
  const d = types.indexOf("day");
  const m = types.indexOf("month");
  const y = types.indexOf("year");
  if (d < 0 || m < 0 || y < 0) return null;
  return orderFromPositions(d, m, y);
}

function orderFromPositions(d: number, m: number, y: number): DateOrder | null {
  if (y < d && y < m) return "YMD";
  if (d < m && m < y) return "DMY";
  if (m < d && d < y) return "MDY";
  // Year-last with day/month interleaved oddly, or year in the middle: no supported order.
  return null;
}

/** Placeholder text for an empty field, e.g. `DD/MM/YYYY`. */
export function datePlaceholder(order: DateOrder): string {
  const names = { D: "DD", M: "MM", Y: "YYYY" } as const;
  return order.split("").map((c) => names[c as "D" | "M" | "Y"]).join(DATE_SEPARATOR);
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function toISO(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Split a strict ISO `YYYY-MM-DD` into numbers, or null if it is not a real calendar date. */
export function parseISODate(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return isRealDate(year, month, day) ? { year, month, day } : null;
}

/** ISO `YYYY-MM-DD` → display text in the region's order, or null for anything else. */
export function formatDisplayDate(iso: string, order: DateOrder): string | null {
  const parts = parseISODate(iso);
  if (!parts) return null;
  const dd = String(parts.day).padStart(2, "0");
  const mm = String(parts.month).padStart(2, "0");
  const yyyy = String(parts.year).padStart(4, "0");
  const fields = { D: dd, M: mm, Y: yyyy } as const;
  return order.split("").map((c) => fields[c as "D" | "M" | "Y"]).join(DATE_SEPARATOR);
}

/**
 * Typed text → ISO `YYYY-MM-DD`, or null when it is not a real date.
 *
 * Accepts `/`, `.`, `-` or spaces between fields, one- or two-digit day and month, and
 * a four-digit year. Text that starts with a four-digit year is read as year-month-day
 * whatever the region, so a pasted ISO date always works; otherwise the region's order
 * decides which field is the day and which the month.
 */
export function parseDisplayDate(input: string, order: DateOrder): string | null {
  const fields = input.trim().split(/\s*[/.\-\s]\s*/);
  if (fields.length !== 3 || !fields.every((f) => /^\d+$/.test(f))) return null;

  let year: string, month: string, day: string;
  if (/^\d{4}$/.test(fields[0])) {
    [year, month, day] = fields;
  } else if (order === "DMY") {
    [day, month, year] = fields;
  } else if (order === "MDY") {
    [month, day, year] = fields;
  } else {
    return null; // YMD order but the first field is not a four-digit year
  }

  if (!/^\d{4}$/.test(year) || day.length > 2 || month.length > 2) return null;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  return isRealDate(y, mo, d) ? toISO(y, mo, d) : null;
}
