"use client";

import { useState } from "react";
import { addDaysYmd, formatYmd, ymdToDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Picking a span of days in one control.
 *
 * Two `<input type="date">` fields is the cheap way to ask for a range, and on
 * a phone it's the wrong one: each field opens the OS date wheel on its own,
 * so choosing a fortnight means two full-screen pickers, two confirmations,
 * and no moment where both ends are visible together. A range is one idea and
 * it should take one gesture — tap the first day, tap the last, see the whole
 * thing shaded in between.
 *
 * Hand-rolled rather than imported. A calendar is a month grid, a cursor and
 * two comparisons; the libraries that do it bring a locale layer and a styling
 * system this app already has its own answers for, and every kilobyte of them
 * ships to a phone.
 *
 * Everything is yyyymmdd, the same string the rest of the app speaks, so
 * nothing here has to think about timezones: the only Date it constructs is
 * for reading a weekday and a month name out of a date that is already fixed.
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** First of the month containing `ymd`. */
function monthStart(ymd: string): string {
  return `${ymd.slice(0, 6)}01`;
}

function shiftMonth(monthYmd: string, delta: number): string {
  const year = Number(monthYmd.slice(0, 4));
  const month = Number(monthYmd.slice(4, 6)) - 1 + delta;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return `${y}${String(m + 1).padStart(2, "0")}01`;
}

/**
 * Every cell of the month's grid, padded to whole weeks with the blanks a
 * month never starts on a Monday needs.
 */
function monthGrid(monthYmd: string): (string | null)[] {
  const first = ymdToDate(monthYmd);
  // getDay is Sunday-0; the grid is Monday-first, matching the week strips
  // everywhere else in the app.
  const leading = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  const month = monthYmd.slice(0, 6);
  let cursor = monthYmd;
  while (cursor.slice(0, 6) === month) {
    cells.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function DateRangeCalendar({
  start,
  end,
  min,
  onChange,
}: {
  /** yyyymmdd, or "" for nothing chosen yet. */
  start: string;
  end: string;
  /** Earliest selectable day, yyyymmdd. */
  min: string;
  onChange: (next: { start: string; end: string }) => void;
}) {
  const [month, setMonth] = useState(() => monthStart(start || min));

  /**
   * One tap does one of two things, decided by what's already chosen rather
   * than by a mode the user has to track: with nothing or a finished range,
   * open a new one; with a start and no end, close it.
   *
   * The first tap deliberately leaves `end` empty rather than setting it to
   * the same day. Making it a complete one-day range reads fine and then
   * breaks the very next tap — the range is "finished", so choosing the last
   * day of your holiday starts a new range on it instead of extending to it,
   * and the only way to get a span is to tap the first day twice. Leaving it
   * open costs nothing: tapping the same day again closes it as a single day,
   * which is what someone booking one day off would do anyway.
   *
   * Tapping before the start closes the range backwards instead of refusing.
   * A misjudged first tap is the commonest slip, and "that's your new start"
   * is never what someone meant by reaching for an earlier day.
   */
  function handlePick(ymd: string) {
    if (!start || (start && end)) {
      onChange({ start: ymd, end: "" });
      return;
    }
    onChange(ymd < start ? { start: ymd, end: start } : { start, end: ymd });
  }

  const cells = monthGrid(month);
  const monthLabel = formatYmd(month, "MMMM yyyy");
  // A month entirely before `min` has nothing to offer; the arrow says so
  // rather than letting someone page into a wall of dead cells.
  const canGoBack = shiftMonth(month, 0) > monthStart(min);

  return (
    <div className="rounded-xl border-2 border-input p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!canGoBack}
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label="Previous month"
          className="flex h-11 w-11 items-center justify-center rounded-md text-lg text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ‹
        </button>
        <span aria-live="polite" className="text-sm font-medium">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          aria-label="Next month"
          className="flex h-11 w-11 items-center justify-center rounded-md text-lg text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ›
        </button>
      </div>

      <div className="mt-1 grid grid-cols-7">
        {WEEKDAYS.map((letter, i) => (
          <span
            key={i}
            aria-hidden
            className="py-1 text-center type-overline text-[11px] text-muted-foreground"
          >
            {letter}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((ymd, i) => {
          if (!ymd) return <span key={`pad${i}`} />;
          const disabled = ymd < min;
          const inRange = Boolean(start && end && ymd >= start && ymd <= end);
          const isStart = Boolean(start) && ymd === start;
          const isEnd = Boolean(end) && ymd === end;
          const edge = isStart || isEnd;
          // A start with no end yet is a whole pill rather than a half one,
          // so a half-finished selection doesn't look like a rendering fault.
          const lone = isStart && !end;
          return (
            <button
              key={ymd}
              type="button"
              disabled={disabled}
              aria-pressed={inRange}
              aria-label={formatYmd(ymd, "EEEE d MMMM")}
              onClick={() => handlePick(ymd)}
              className={cn(
                // 44px of touch target, which is the whole reason this exists.
                "h-11 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                disabled && "text-muted-foreground/30",
                !disabled && !inRange && "hover:bg-accent",
                // Square middles, rounded ends: the run reads as one shape
                // rather than a row of separate chips.
                inRange && !edge && "bg-secondary",
                edge && "bg-foreground text-background font-semibold",
                isStart && "rounded-l-md",
                isEnd && "rounded-r-md",
                lone && "rounded-md",
                inRange && !edge && "rounded-none"
              )}
            >
              {Number(ymd.slice(6, 8))}
            </button>
          );
        })}
      </div>

      {/* Says which half of the gesture you're in. Without it, a chosen start
          with no end looks like a finished selection that simply hasn't
          enabled the button. */}
      <p aria-live="polite" className="mt-2 text-center text-xs text-muted-foreground">
        {!start
          ? "Tap the first day"
          : !end
            ? `${formatYmd(start)} — now tap the last day`
            : `${formatYmd(start)} – ${formatYmd(end)}`}
      </p>
    </div>
  );
}
