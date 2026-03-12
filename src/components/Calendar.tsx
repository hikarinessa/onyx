import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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

interface CalendarProps {
  onDateClick: (isoDate: string) => void;
}

function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    // Recalculate at midnight
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

export function Calendar({ onDateClick }: CalendarProps) {
  const today = useToday();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
  const [datesWithNotes, setDatesWithNotes] = useState<Set<number>>(new Set());

  const fetchDates = useCallback(async () => {
    try {
      const days = await invoke<number[]>("get_dates_with_notes", {
        year: viewYear,
        month: viewMonth + 1, // Rust expects 1-indexed
      });
      setDatesWithNotes(new Set(days));
    } catch {
      setDatesWithNotes(new Set());
    }
  }, [viewYear, viewMonth]);

  useEffect(() => {
    fetchDates();
  }, [fetchDates]);

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
  // Monday = 0, Sunday = 6 (ISO)
  const startDay = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const cells: { day: number; month: number; year: number; isCurrentMonth: boolean }[] = [];

  // Previous month's trailing days
  for (let i = startDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const m = viewMonth === 0 ? 11 : viewMonth - 1;
    const y = viewMonth === 0 ? viewYear - 1 : viewYear;
    cells.push({ day: d, month: m, year: y, isCurrentMonth: false });
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month: viewMonth, year: viewYear, isCurrentMonth: true });
  }

  // Next month's leading days (fill to 42 = 6 rows)
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const m = viewMonth === 11 ? 0 : viewMonth + 1;
    const y = viewMonth === 11 ? viewYear + 1 : viewYear;
    cells.push({ day: d, month: m, year: y, isCurrentMonth: false });
  }

  const isViewingCurrentMonth =
    viewYear === today.getFullYear() && viewMonth === today.getMonth();

  return (
    <div className="calendar">
      <div className="calendar-header">
        <button
          className={`calendar-nav-btn calendar-today-btn ${isViewingCurrentMonth ? "hidden" : ""}`}
          onClick={goToToday}
          aria-label="Go to today"
          tabIndex={isViewingCurrentMonth ? -1 : 0}
        >
          Today
        </button>
        <button className="calendar-nav-btn" onClick={prevMonth} aria-label="Previous month">‹</button>
        <span className="calendar-title">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button className="calendar-nav-btn" onClick={nextMonth} aria-label="Next month">›</button>
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${MONTH_NAMES[viewMonth]} ${viewYear}`}>
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="calendar-weekday" role="columnheader">{wd}</div>
        ))}
        {cells.map((cell, i) => {
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
              key={i}
              className={classes}
              role="button"
              tabIndex={cell.isCurrentMonth ? 0 : -1}
              aria-label={`${cell.day} ${MONTH_NAMES[cell.month]} ${cell.year}${hasNote ? ", has note" : ""}`}
              onClick={() => onDateClick(isoDate)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onDateClick(isoDate);
                }
              }}
            >
              {cell.day}
            </div>
          );
        })}
      </div>
    </div>
  );
}
