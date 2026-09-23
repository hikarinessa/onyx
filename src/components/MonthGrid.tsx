import { Icon } from "./Icon";
import {
  MONTH_NAMES,
  MONTH_SHORT,
  WEEKDAYS,
  getISOWeek,
  isSameDay,
  toISODate,
  toISOWeekString,
} from "../lib/calendarDates";

export interface MonthGridWeeks {
  /** ISO week strings (YYYY-Www) that have a weekly note. */
  withNotes: Set<string>;
  onClick: (isoWeek: string, newTab: boolean) => void;
}

interface MonthGridProps {
  /** Wrapper class; the context panel uses the default. */
  className?: string;
  viewYear: number;
  /** 0-based month. */
  viewMonth: number;
  today: Date;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  /** ISO date drawn with the `active` style. */
  highlightedDate: string | null;
  /** Daily-note dots keyed by "YYYY-M" (0-based month) → day numbers. */
  notesByMonth?: Map<string, Set<number>>;
  /** Week-number column; omitted, the grid shows days only. */
  weeks?: MonthGridWeeks;
  onDateClick: (isoDate: string, newTab: boolean) => void;
  onDateContextMenu?: (isoDate: string, hasNote: boolean, x: number, y: number) => void;
}

interface Cell {
  day: number;
  month: number;
  year: number;
  isCurrentMonth: boolean;
}

/** Six Monday-first rows covering the month, padded with the neighbouring months' days. */
function buildWeeks(viewYear: number, viewMonth: number): Cell[][] {
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startDay = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const cells: Cell[] = [];

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

  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/** Month header plus day grid, shared by the context panel calendar and the date picker. */
export function MonthGrid({
  className = "calendar",
  viewYear,
  viewMonth,
  today,
  onPrevMonth,
  onNextMonth,
  onToday,
  highlightedDate,
  notesByMonth,
  weeks,
  onDateClick,
  onDateContextMenu,
}: MonthGridProps) {
  const rows = buildWeeks(viewYear, viewMonth);
  const isViewingCurrentMonth =
    viewYear === today.getFullYear() && viewMonth === today.getMonth();

  return (
    <div className={className}>
      <div className="calendar-header">
        <span className="calendar-title">
          {MONTH_SHORT[viewMonth]} <span className="calendar-year">{viewYear}</span>
        </span>
        <div className="calendar-nav">
          <button className="calendar-nav-btn" onClick={onPrevMonth} aria-label="Previous month"><Icon name="chevron-left" size={14} /></button>
          <button
            className={`calendar-nav-btn calendar-today-btn ${isViewingCurrentMonth ? "hidden" : ""}`}
            onClick={onToday}
            aria-label="Go to today"
            tabIndex={isViewingCurrentMonth ? -1 : 0}
          >
            TODAY
          </button>
          <button className="calendar-nav-btn" onClick={onNextMonth} aria-label="Next month"><Icon name="chevron-right" size={14} /></button>
        </div>
      </div>
      <div
        className={weeks ? "calendar-grid" : "calendar-grid calendar-grid-days-only"}
        role="grid"
        aria-label={`${MONTH_NAMES[viewMonth]} ${viewYear}`}
      >
        {/* Column headers: W + weekday names */}
        {weeks && <div className="calendar-weekday calendar-week-header" role="columnheader">W</div>}
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="calendar-weekday" role="columnheader">{wd}</div>
        ))}

        {/* Rows: week number + 7 day cells */}
        {rows.map((week, wi) => {
          // Use Monday of this week row for the ISO week number
          const monday = week[0];
          const mondayDate = new Date(monday.year, monday.month, monday.day);
          const weekNum = getISOWeek(mondayDate);
          const weekStr = toISOWeekString(mondayDate);
          const hasWeekNote = weeks?.withNotes.has(weekStr) ?? false;

          return (
            <div key={wi} className="calendar-week-row">
              {weeks && (
                <div
                  className={`calendar-week-num ${hasWeekNote ? "has-note" : ""}`}
                  role="button"
                  tabIndex={0}
                  title={`Week ${weekNum} — click to open weekly note`}
                  onClick={(e) => weeks.onClick(weekStr, e.metaKey)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      weeks.onClick(weekStr, e.metaKey);
                    }
                  }}
                >
                  {weekNum}
                </div>
              )}
              {week.map((cell, ci) => (
                <DayCell
                  key={ci}
                  cell={cell}
                  today={today}
                  hasNote={notesByMonth?.get(`${cell.year}-${cell.month}`)?.has(cell.day) ?? false}
                  highlightedDate={highlightedDate}
                  onDateClick={onDateClick}
                  onDateContextMenu={onDateContextMenu}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayCell({
  cell,
  today,
  hasNote,
  highlightedDate,
  onDateClick,
  onDateContextMenu,
}: {
  cell: Cell;
  today: Date;
  hasNote: boolean;
  highlightedDate: string | null;
  onDateClick: (isoDate: string, newTab: boolean) => void;
  onDateContextMenu?: (isoDate: string, hasNote: boolean, x: number, y: number) => void;
}) {
  const cellDate = new Date(cell.year, cell.month, cell.day);
  const isToday = isSameDay(cellDate, today);
  const isPast = cell.isCurrentMonth && cellDate < today && !isToday;
  const isoDate = toISODate(cell.year, cell.month, cell.day);
  const isActive = highlightedDate === isoDate;
  const classes = [
    "calendar-day",
    cell.isCurrentMonth ? "" : "other-month",
    isToday ? "today" : "",
    isPast ? "past" : "",
    hasNote ? "has-note" : "",
    isActive ? "active" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      role="button"
      tabIndex={cell.isCurrentMonth ? 0 : -1}
      aria-label={`${cell.day} ${MONTH_NAMES[cell.month]} ${cell.year}${hasNote ? ", has note" : ""}`}
      onClick={(e) => onDateClick(isoDate, e.metaKey)}
      onContextMenu={(e) => {
        if (onDateContextMenu) {
          e.preventDefault();
          onDateContextMenu(isoDate, hasNote, e.clientX, e.clientY);
        }
      }}
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
}
