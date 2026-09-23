import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MonthGrid } from "./MonthGrid";
import { Icon } from "./Icon";
import { shiftMonth } from "../lib/calendarDates";
import { useToday } from "../lib/useToday";
import {
  type DateOrder,
  dateOrderFromPartTypes,
  dateOrderFromPattern,
  datePlaceholder,
  formatDisplayDate,
  parseDisplayDate,
  parseISODate,
} from "../lib/dateFormat";

// ── Region date order ──

/** What the webview's own Intl says; only right when the region matches the UI language. */
function intlDateOrder(): DateOrder {
  const types = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(2000, 0, 31))
    .map((p) => p.type);
  return dateOrderFromPartTypes(types) ?? "YMD";
}

let regionOrder: DateOrder | null = null;
let regionOrderRequest: Promise<DateOrder> | null = null;

function loadRegionOrder(): Promise<DateOrder> {
  regionOrderRequest ??= invoke<string | null>("get_region_date_pattern")
    .then((pattern) => (pattern ? dateOrderFromPattern(pattern) : null) ?? intlDateOrder())
    .catch(() => intlDateOrder())
    .then((order) => (regionOrder = order));
  return regionOrderRequest;
}

/** Date order of the macOS region, read once per session from the backend. */
function useRegionDateOrder(): DateOrder {
  const [order, setOrder] = useState<DateOrder>(() => regionOrder ?? intlDateOrder());
  useEffect(() => {
    let live = true;
    loadRegionOrder().then((o) => { if (live) setOrder(o); });
    return () => { live = false; };
  }, []);
  return order;
}

// ── Field ──

const POPUP_WIDTH = 232;
const POPUP_HEIGHT_ESTIMATE = 220;
const VIEWPORT_PAD = 8;

type PopupPosition = { left: number; top?: number; bottom?: number };

function positionBelow(anchor: DOMRect): PopupPosition {
  const left = Math.max(
    VIEWPORT_PAD,
    Math.min(anchor.right - POPUP_WIDTH, window.innerWidth - POPUP_WIDTH - VIEWPORT_PAD),
  );
  const roomBelow = window.innerHeight - anchor.bottom;
  if (roomBelow < POPUP_HEIGHT_ESTIMATE + VIEWPORT_PAD && anchor.top > roomBelow) {
    return { left, bottom: window.innerHeight - anchor.top + 4 };
  }
  return { left, top: anchor.bottom + 4 };
}

/**
 * Date property: a text field in the region's order (DD/MM/YYYY for a German region)
 * with a themed month-grid pop-up. The stored value stays ISO `YYYY-MM-DD`; text that
 * does not parse to a real date never reaches `onChange`.
 */
export function DatePropertyField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const order = useRegionDateOrder();
  const today = useToday();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipCommitRef = useRef(false);

  // null while not editing: the field shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  // Set when Enter meets text that is not a date; cleared by the next edit.
  const [rejected, setRejected] = useState(false);
  const [popup, setPopup] = useState<PopupPosition | null>(null);
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }));

  const stored = value ?? "";
  // A value that is not a plain ISO date (hand-edited frontmatter) is shown as written.
  const storedDisplay = formatDisplayDate(stored, order) ?? stored;
  const shown = draft ?? storedDisplay;
  const draftISO = draft === null ? null : parseDisplayDate(draft, order);
  const invalid = draft !== null && draft.trim() !== "" && draftISO === null;
  const selectedISO = draftISO ?? (parseISODate(stored) ? stored : null);

  // Keep the pop-up attached to the field while the context panel scrolls or the window
  // resizes. Keyed on open/closed, not the position, so moving it doesn't re-subscribe.
  const popupOpen = popup !== null;
  useEffect(() => {
    if (!popupOpen) return;
    const place = () => {
      if (wrapRef.current) setPopup(positionBelow(wrapRef.current.getBoundingClientRect()));
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [popupOpen]);

  const open = () => {
    if (!wrapRef.current) return;
    const parts = parseISODate(stored);
    setView(parts ? { year: parts.year, month: parts.month - 1 } : { year: today.getFullYear(), month: today.getMonth() });
    skipCommitRef.current = false;
    setDraft(storedDisplay);
    setRejected(false);
    setPopup(positionBelow(wrapRef.current.getBoundingClientRect()));
  };

  const close = () => {
    setDraft(null);
    setRejected(false);
    setPopup(null);
  };

  /** Write the draft if it is a real date or empty; anything else leaves the stored value alone. */
  const commit = () => {
    if (draft !== null) {
      if (draft.trim() === "") {
        if (stored !== "") onChange(null);
      } else if (draftISO !== null && draftISO !== stored) {
        onChange(draftISO);
      }
    }
    close();
  };

  /** Leave the field without committing the draft. Focus may be on a day cell inside
   *  the pop-up (keyboard use), which is about to unmount: bring it back to the input
   *  first so blurring leaves focus somewhere sensible instead of on the page. */
  const leaveWithoutCommit = () => {
    skipCommitRef.current = true;
    close();
    inputRef.current?.focus();
    inputRef.current?.blur();
  };

  const pick = (iso: string) => {
    if (iso !== stored) onChange(iso);
    leaveWithoutCommit();
  };

  /** Leave the field without writing (Escape). */
  const cancel = leaveWithoutCommit;

  const handleBlur = (e: React.FocusEvent) => {
    // Focus moving into the pop-up (keyboard users tabbing to a day) keeps the field open.
    if (wrapRef.current?.contains(e.relatedTarget as Node | null)) return;
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      return;
    }
    commit();
  };

  const moveView = (delta: -1 | 1) => setView((v) => shiftMonth(v.year, v.month, delta));

  return (
    <div
      ref={wrapRef}
      className="prop-date"
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === "Escape" && popup) {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <input
        ref={inputRef}
        type="text"
        className={`prop-input prop-input-date${rejected ? " invalid" : ""}`}
        value={shown}
        placeholder={datePlaceholder(order)}
        aria-invalid={rejected || undefined}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => { if (!popup) open(); }}
        onMouseDown={() => { if (!popup && document.activeElement === inputRef.current) open(); }}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          setRejected(false);
          if (!popup && wrapRef.current) setPopup(positionBelow(wrapRef.current.getBoundingClientRect()));
          const iso = parseDisplayDate(text, order);
          const parts = iso ? parseISODate(iso) : null;
          if (parts) setView({ year: parts.year, month: parts.month - 1 });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // Invalid text stays in the field, marked, until corrected or abandoned.
            if (invalid) {
              setRejected(true);
              return;
            }
            commit();
            skipCommitRef.current = true;
            inputRef.current?.blur();
          }
        }}
      />
      <button
        type="button"
        className="prop-date-toggle"
        aria-label={popup ? "Close calendar" : "Open calendar"}
        tabIndex={-1}
        // Keep focus in the field so clicking the icon does not count as leaving it.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!popup) {
            inputRef.current?.focus();
            return;
          }
          commit();
          skipCommitRef.current = true;
          inputRef.current?.blur();
        }}
      >
        <Icon name="calendar" size={12} />
      </button>
      {popup && (
        <div
          className="date-picker-popup"
          style={{ left: popup.left, top: popup.top, bottom: popup.bottom, width: POPUP_WIDTH }}
          // Clicks on nav buttons and days must not blur the field (WebKit does not focus
          // buttons on click, so the blur would carry no relatedTarget and close the pop-up).
          onMouseDown={(e) => e.preventDefault()}
        >
          <MonthGrid
            className="calendar date-picker-calendar"
            viewYear={view.year}
            viewMonth={view.month}
            today={today}
            onPrevMonth={() => moveView(-1)}
            onNextMonth={() => moveView(1)}
            onToday={() => setView({ year: today.getFullYear(), month: today.getMonth() })}
            highlightedDate={selectedISO}
            onDateClick={(iso) => pick(iso)}
          />
        </div>
      )}
    </div>
  );
}
