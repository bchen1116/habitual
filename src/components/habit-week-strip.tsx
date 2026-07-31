"use client";

import { formatYmd } from "@/lib/dates";
import type { HabitWeek } from "@/lib/progress";
import { cn } from "@/lib/utils";

/**
 * This habit's current seven days, on its own calendar.
 *
 * A habit that starts on a Friday counts Friday-to-Thursday everywhere it
 * matters — adjudication, skips, the History list — but the only week strip
 * in the app was the dashboard's, which is Monday-anchored because it spans
 * every habit at once. So the one screen dedicated to a single habit had
 * nowhere showing that habit's week the way the habit itself counts it.
 *
 * Deliberately not volt-filled: the check-in button on this screen already
 * spends the one-volt-element budget, so completed days take the same ink
 * fill the History grid uses. Today keeps the volt outline the grid gives it,
 * for consistency with the card directly below.
 */
export function HabitWeekStrip({ week }: { week: HabitWeek }) {
  const complete = week.count >= week.target;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="type-overline text-xs text-muted-foreground">
          Week {week.index} of {week.totalWeeks} · {formatYmd(week.start)} –{" "}
          {formatYmd(week.end)}
        </span>
        <span
          className={cn(
            "type-overline shrink-0 text-xs",
            complete ? "font-bold text-foreground" : "text-muted-foreground"
          )}
        >
          {week.count}/{week.target}
        </span>
      </div>

      <div aria-hidden className="mt-2.5 flex gap-1.5">
        {week.days.map((day) => (
          <div key={day.ymd} className="flex flex-1 flex-col items-center gap-1.5">
            <div
              title={`${formatYmd(day.ymd)}: ${day.state}`}
              className={cn(
                "h-9 w-full rounded-md",
                day.state === "done" && "bg-foreground",
                day.state === "missed" && "bg-destructive/15",
                day.state === "today" && "border-2 border-primary bg-secondary",
                day.state === "future" && "bg-secondary",
                // Before this member joined: never red, because they weren't
                // here to miss it — the same fairness the skip math applies.
                day.state === "inactive" && "bg-secondary/50"
              )}
            />
            <span
              className={cn(
                "type-overline text-[11px]",
                day.ymd === week.start || day.state === "today"
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {day.letter}
            </span>
          </div>
        ))}
      </div>

      {/* The bars are decorative; this is the version a screen reader gets. */}
      <ul className="sr-only">
        {week.days.map((day) => (
          <li key={day.ymd}>
            {formatYmd(day.ymd, "EEEE MMM d")}: {day.state}
          </li>
        ))}
      </ul>
    </div>
  );
}
