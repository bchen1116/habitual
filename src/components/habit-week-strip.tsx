"use client";

import { formatYmd } from "@/lib/dates";
import type { HabitWeek } from "@/lib/progress";
import { cn } from "@/lib/utils";

/**
 * This habit's current seven days, on its own calendar.
 *
 * A habit that starts on a Friday counts Friday-to-Thursday everywhere it
 * matters — adjudication, skips, the History list — so its week is shown
 * that way here, letters and all. There used to be a single Monday-anchored
 * strip on Today covering every habit at once, which stops meaning anything
 * the moment you have more than one: two habits that started on different
 * days share no week, and averaging them describes neither.
 *
 * `tone` picks the fill for completed days. Today's habit rows use "volt",
 * which is the whole point of the strip there — progress you can read at a
 * glance from across the room. The habit detail screen uses "ink", because
 * its check-in button already carries that screen's volt.
 */
export function HabitWeekStrip({
  week,
  tone = "ink",
  dense = false,
  className,
  onSelectMissedDay,
}: {
  week: HabitWeek;
  tone?: "ink" | "volt";
  dense?: boolean;
  className?: string;
  /**
   * Makes missed days tappable, for logging one after the fact. Omitted
   * everywhere the day can't be acted on — Today's rows, and any habit whose
   * cycle has been graded — so the strip stays a read-out unless it isn't.
   */
  onSelectMissedDay?: (ymd: string) => void;
}) {
  const complete = week.count >= week.target;
  // Hitting the target has never stopped anyone checking in — the only gate is
  // one per day — but a bold "5/5" reads as "done, stop", so days done beyond
  // it are counted out loud instead of disappearing into a number that already
  // looks finished. They're real: each one adds a day to the streak.
  const extra = week.count - week.target;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="type-overline truncate text-xs text-muted-foreground">
          {dense
            ? `Week ${week.index} · ${formatYmd(week.start)}`
            : `Week ${week.index} of ${week.totalWeeks} · ${formatYmd(week.start)} – ${formatYmd(week.end)}`}
        </span>
        <span
          className={cn(
            "type-overline shrink-0 text-xs",
            complete ? "font-bold text-foreground" : "text-muted-foreground"
          )}
        >
          {week.count}/{week.target}
          {extra > 0 && (
            <span className="ml-1 font-normal text-muted-foreground">
              +{extra} extra
            </span>
          )}
          {/* The invitation lives beside the numbers rather than in the habit
              row's name column, which the check-in button squeezes to about
              two words. */}
          {extra === 0 && complete && week.allowsExtras && week.daysLeft && (
            <span className="ml-1 font-normal text-muted-foreground">
              · extras count
            </span>
          )}
        </span>
      </div>

      {/* Not aria-hidden when the cells are controls: a decorative strip can be
          skipped, but a row of buttons cannot. Without a handler it stays
          decorative and hidden, as it was. */}
      <div
        aria-hidden={onSelectMissedDay ? undefined : true}
        className={cn("flex gap-1.5", dense ? "mt-2" : "mt-2.5")}
      >
        {week.days.map((day) => {
          const tappable = Boolean(onSelectMissedDay) && day.state === "missed";
          const Cell = tappable ? "button" : "div";
          return (
          <div key={day.ymd} className="flex flex-1 flex-col items-center gap-1">
            <Cell
              type={tappable ? "button" : undefined}
              onClick={tappable ? () => onSelectMissedDay?.(day.ymd) : undefined}
              title={
                tappable
                  ? `${formatYmd(day.ymd)}: missed — tap to log it`
                  : day.state === "skipped"
                    ? `${formatYmd(day.ymd)}: time off — nothing was due`
                    : `${formatYmd(day.ymd)}: ${day.state}`
              }
              aria-label={
                tappable
                  ? `${formatYmd(day.ymd)}: missed. Log it as done.`
                  : undefined
              }
              className={cn(
                "w-full rounded-md",
                dense ? "h-7" : "h-9",
                tappable &&
                  "ring-1 ring-inset ring-destructive/50 transition-colors hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                day.state === "done" && (tone === "volt" ? "bg-primary" : "bg-foreground"),
                day.state === "missed" && "bg-destructive/15",
                day.state === "today" && "border-2 border-primary bg-secondary",
                day.state === "future" && "bg-secondary",
                // Before this member joined: never red, because they weren't
                // here to miss it — the same fairness the skip math applies.
                day.state === "inactive" && "bg-secondary/50",
                // Declared time off. An outline rather than a fill, matching
                // the history grid: a hole in the record by arrangement, which
                // must read as neither kept nor dropped.
                day.state === "skipped" &&
                  "border border-dashed border-muted-foreground/50"
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
          );
        })}
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
