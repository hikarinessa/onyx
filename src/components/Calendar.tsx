import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function toISODate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** ISO 8601 week number (Monday-based, week 1 contains Jan 4) */
function getISOWeek(date: Date): number {
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
function toISOWeekString(date: Date): string {
  const wy = getISOWeekYear(date);
  const wn = String(getISOWeek(date)).padStart(2, "0");
  return `${wy}-W${wn}`;
}

interface CalendarProps {
  onDateClick: (isoDate: string, newTab: boolean) => void;
  onWeekClick: (isoWeek: string, newTab: boolean) => void;
}

function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = midnight.getTime() - now.getTime();
    const timer = setTimeout(() => {
      setToday(new Date());
    }, msUntilMidnight);
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}

export function Calendar({ onDateClick, onWeekClick }: CalendarProps) {
  const today = useToday();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [datesWithNotes, setDatesWithNotes] = useState<Set<number>>(new Set());
  const [weeksWithNotes, setWeeksWithNotes] = useState<Set<string>>(new Set());

  const fetchNoteIndicators = useCallback(async () => {
    // Fetch daily note indicators
    try {
      const days = await invoke<number[]>("get_dates_with_notes", {
        year: viewYear,
        month: viewMonth + 1,
      });
      setDatesWithNotes(new Set(days));
    } catch {
      setDatesWithNotes(new Set());
    }

    // Compute visible week strings and fetch weekly note indicators
    try {
      const firstOfMonth = new Date(viewYear, viewMonth, 1);
      const startDay = (firstOfMonth.getDay() + 6) % 7;
      const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
      // Monday of first row
      const firstMonday = new Date(viewYear, viewMonth, 1 - startDay);
      const weekStrings: string[] = [];
      for (let row = 0; row < 6; row++) {
        const monday = new Date(firstMonday);
        monday.setDate(monday.getDate() + row * 7);
        weekStrings.push(toISOWeekString(monday));
      }
      const found = await invoke<string[]>("get_weeks_with_notes", { weeks: weekStrings });
      setWeeksWithNotes(new Set(found));
    } catch {
      setWeeksWithNotes(new Set());
    }
  }, [viewYear, viewMonth]);

  useEffect(() => {
    fetchNoteIndicators();
  }, [fetchNoteIndicators]);

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  // Build calendar grid
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startDay = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const cells: { day: number; month: number; year: number; isCurrentMonth: boolean }[] = [];

  for (let i = startDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const m = viewMonth === 0 ? 11 : viewMonth - 1;
    const y = viewMonth === 0 ? viewYear - 1 : viewYear;
    cells.push({ day: d, month: m, year: y, isCurrentMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: viewMonth, year: viewYear, isCurrentMonth: true });
  }

  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 11 ? 0 : viewMonth + 1;
    const y = viewMonth === 11 ? viewYear + 1 : viewYear;
    cells.push({ day: d, month: m, year: y, isCurrentMonth: false });
  }

  // Group cells into weeks (7 per row)
  const weeks: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const isViewingCurrentMonth =
    viewYear === today.getFullYear() && viewMonth === today.getMonth();

  return (
    <div className="calendar">
      <div className="calendar-header">
        <span className="calendar-title">
          {MONTH_SHORT[viewMonth]} <span className="calendar-year">{viewYear}</span>
        </span>
        <div className="calendar-nav">
          <button className="calendar-nav-btn" onClick={prevMonth} aria-label="Previous month">‹</button>
          <button
            className={`calendar-nav-btn calendar-today-btn ${isViewingCurrentMonth ? "hidden" : ""}`}
            onClick={goToToday}
            aria-label="Go to today"
            tabIndex={isViewingCurrentMonth ? -1 : 0}
          >
            TODAY
          </button>
          <button className="calendar-nav-btn" onClick={nextMonth} aria-label="Next month">›</button>
        </div>
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${MONTH_NAMES[viewMonth]} ${viewYear}`}>
        {/* Column headers: W + weekday names */}
        <div className="calendar-weekday calendar-week-header" role="columnheader">W</div>
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="calendar-weekday" role="columnheader">{wd}</div>
        ))}

        {/* Rows: week number + 7 day cells */}
        {weeks.map((week, wi) => {
          // Use Monday of this week row for the ISO week number
          const monday = week[0];
          const mondayDate = new Date(monday.year, monday.month, monday.day);
          const weekNum = getISOWeek(mondayDate);
          const weekStr = toISOWeekString(mondayDate);
          const hasWeekNote = weeksWithNotes.has(weekStr);

          return (
            <div key={wi} className="calendar-week-row">
              <div
                className={`calendar-week-num ${hasWeekNote ? "has-note" : ""}`}
                role="button"
                tabIndex={0}
                title={`Week ${weekNum} — click to open weekly note`}
                onClick={(e) => onWeekClick(weekStr, e.metaKey)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onWeekClick(weekStr, e.metaKey);
                  }
                }}
              >
                {weekNum}
              </div>
              {week.map((cell, ci) => {
                const cellDate = new Date(cell.year, cell.month, cell.day);
                const isToday = isSameDay(cellDate, today);
                const hasNote = cell.isCurrentMonth && datesWithNotes.has(cell.day);
                const isPast = cell.isCurrentMonth && cellDate < today && !isToday;
                const classes = [
                  "calendar-day",
                  cell.isCurrentMonth ? "" : "other-month",
                  isToday ? "today" : "",
                  isPast ? "past" : "",
                  hasNote ? "has-note" : "",
                ].filter(Boolean).join(" ");
                const isoDate = toISODate(cell.year, cell.month, cell.day);

                return (
                  <div
                    key={ci}
                    className={classes}
                    role="button"
                    tabIndex={cell.isCurrentMonth ? 0 : -1}
                    aria-label={`${cell.day} ${MONTH_NAMES[cell.month]} ${cell.year}${hasNote ? ", has note" : ""}`}
                    onClick={(e) => onDateClick(isoDate, e.metaKey)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onDateClick(isoDate, e.metaKey);
                      }
                    }}
                  >
                    {cell.day}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
