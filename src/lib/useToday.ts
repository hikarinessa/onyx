import { useEffect, useState } from "react";

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * Today's date, updated when the day changes. A timeout set for midnight is not enough:
 * timers stop while the Mac sleeps, so one set before sleep fires late after wake. A
 * minute poll, plus a check whenever the window returns, catches the rollover however
 * it happened.
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const check = () => {
      const now = new Date();
      setToday((prev) => (dayKey(prev) === dayKey(now) ? prev : now));
    };
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return today;
}
