/** Date helpers shared by the context panel calendar and the date property picker. */

export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `month` is 0-based, as in `Date`. */
export function toISODate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** ISO 8601 week number (Monday-based, week 1 contains Jan 4) */
export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** ISO week-year (may differ from calendar year for early Jan / late Dec) */
function getISOWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

/** Format as ISO week date string: YYYY-Www */
export function toISOWeekString(date: Date): string {
  const wy = getISOWeekYear(date);
  const wn = String(getISOWeek(date)).padStart(2, "0");
  return `${wy}-W${wn}`;
}

/** Month before or after `{year, month}` (0-based month). */
export function shiftMonth(year: number, month: number, delta: -1 | 1): { year: number; month: number } {
  if (delta < 0) return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
  return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
}
