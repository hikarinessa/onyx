import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, selectActiveTabPath } from "../stores/app";
import { MonthGrid } from "./MonthGrid";
import { toISOWeekString } from "../lib/calendarDates";
import { useToday } from "../lib/useToday";

interface CalendarProps {
  onDateClick: (isoDate: string, newTab: boolean) => void;
  onWeekClick: (isoWeek: string, newTab: boolean) => void;
  onDateContextMenu?: (isoDate: string, hasNote: boolean, x: number, y: number) => void;
}

export function Calendar({ onDateClick, onWeekClick, onDateContextMenu }: CalendarProps) {
  const today = useToday();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  // Note indicators keyed by "YYYY-MM" → Set of day numbers
  const [notesByMonth, setNotesByMonth] = useState<Map<string, Set<number>>>(new Map());
  const [weeksWithNotes, setWeeksWithNotes] = useState<Set<string>>(new Set());
  const fileTreeVersion = useAppStore((s) => s.fileTreeVersion);
  const activeTabPath = useAppStore(selectActiveTabPath);

  // Extract YYYY-MM-DD from active tab filename for highlighting
  const activeDate = activeTabPath?.match(/(\d{4})-(\d{2})-(\d{2})\.md$/);
  const activeDateStr = activeDate ? `${activeDate[1]}-${activeDate[2]}-${activeDate[3]}` : null;

  const fetchNoteIndicators = useCallback(async () => {
    // Fetch daily note indicators for current month + adjacent months (visible in grid)
    const monthsToFetch: { year: number; month: number }[] = [
      { year: viewMonth === 0 ? viewYear - 1 : viewYear, month: viewMonth === 0 ? 11 : viewMonth - 1 },
      { year: viewYear, month: viewMonth },
      { year: viewMonth === 11 ? viewYear + 1 : viewYear, month: viewMonth === 11 ? 0 : viewMonth + 1 },
    ];
    const newMap = new Map<string, Set<number>>();
    await Promise.all(
      monthsToFetch.map(async ({ year, month }) => {
        try {
          const days = await invoke<number[]>("get_dates_with_notes", { year, month: month + 1 });
          newMap.set(`${year}-${month}`, new Set(days));
        } catch {
          newMap.set(`${year}-${month}`, new Set());
        }
      })
    );
    setNotesByMonth(newMap);

    // Compute visible week strings and fetch weekly note indicators
    try {
      const firstOfMonth = new Date(viewYear, viewMonth, 1);
      const startDay = (firstOfMonth.getDay() + 6) % 7;
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
  }, [fetchNoteIndicators, fileTreeVersion]);

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

  return (
    <MonthGrid
      viewYear={viewYear}
      viewMonth={viewMonth}
      today={today}
      onPrevMonth={prevMonth}
      onNextMonth={nextMonth}
      onToday={goToToday}
      highlightedDate={activeDateStr}
      notesByMonth={notesByMonth}
      weeks={{ withNotes: weeksWithNotes, onClick: onWeekClick }}
      onDateClick={onDateClick}
      onDateContextMenu={onDateContextMenu}
    />
  );
}
