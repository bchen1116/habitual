"use client";

import { formatYmd } from "@/lib/dates";
import type { HabitImpact } from "@/lib/time-off-impact";

/**
 * The breakdown, as a list. Out first, because that's the one with a
 * consequence — no result and no stake — and the one nobody should meet by
 * surprise.
 */
export function TimeOffImpact({
  impacts,
  untouched,
}: {
  impacts: readonly HabitImpact[];
  /** Habits the stretch doesn't reach, counted so their absence isn't ambiguous. */
  untouched: number;
}) {
  if (impacts.length === 0 && untouched === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No habits running over those dates.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {impacts.map((impact) => (
        <div
          key={impact.challenge.id}
          className={
            "rounded-md border px-3 py-2 text-sm " +
            (impact.steppedOut ? "border-dashed" : "")
          }
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-medium">
              {impact.challenge.name}
            </span>
            <span
              className={
                "shrink-0 text-xs " +
                (impact.steppedOut ? "text-foreground" : "text-muted-foreground")
              }
            >
              {impact.steppedOut ? "You're out" : "Still in"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {impact.steppedOut ? (
              <>
                {impact.daysOff} day{impact.daysOff === 1 ? "" : "s"} off is past
                this cycle&apos;s {impact.budget} days of cover, so you sit it out
                from {formatYmd(impact.from!)} to {formatYmd(impact.to!)} — no
                result and no stake either way.
              </>
            ) : (
              <>
                {impact.daysOff} day{impact.daysOff === 1 ? "" : "s"} covered.
                {impact.remaining > 0 ? (
                  <>
                    {" "}
                    You still owe{" "}
                    <span className="font-medium text-foreground">
                      {impact.remaining} check-in
                      {impact.remaining === 1 ? "" : "s"}
                    </span>{" "}
                    on the rest of this cycle, and the stake stands.
                  </>
                ) : (
                  <> Nothing else is due on this cycle.</>
                )}
              </>
            )}
          </p>
        </div>
      ))}
      {untouched > 0 && (
        <p className="text-xs text-muted-foreground">
          {untouched} other habit{untouched === 1 ? "" : "s"} {untouched === 1 ? "isn't" : "aren't"}{" "}
          running over those dates.
        </p>
      )}
    </div>
  );
}
