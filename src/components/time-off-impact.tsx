"use client";

import { formatYmd } from "@/lib/dates";
import type { HabitImpact, HabitImpactGroup } from "@/lib/time-off-impact";

/** "this cycle", "next cycle", "the one after" — plainer than "cycle 3". */
function cycleLabel(index: number): string {
  if (index === 0) return "this cycle";
  if (index === 1) return "next cycle";
  return `cycle ${index + 1}`;
}

function CycleRow({ impact }: { impact: HabitImpact }) {
  const projected = impact.cycleIndex > 0;
  return (
    <div
      className={
        "rounded-md px-3 py-2 " +
        (impact.steppedOut
          ? "border border-dashed"
          : "border border-input")
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          {cycleLabel(impact.cycleIndex)} · {formatYmd(impact.challenge.startDate)}{" "}
          – {formatYmd(impact.challenge.endDate)}
          {/* Said out loud rather than implied by styling: a projected cycle
              is a prediction from the repeat rules, not a document that
              exists, and someone deciding about money should know which. */}
          {projected && " · not created yet"}
        </span>
        <span
          className={
            "shrink-0 text-xs font-medium " +
            (impact.steppedOut ? "text-foreground" : "text-muted-foreground")
          }
        >
          {impact.steppedOut ? "You're out" : "Still in"}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {impact.steppedOut ? (
          <>
            {impact.daysOff} day{impact.daysOff === 1 ? "" : "s"} off is past its{" "}
            {impact.budget} days of cover — no result and no stake either way.
          </>
        ) : (
          <>
            {impact.daysOff} day{impact.daysOff === 1 ? "" : "s"} covered.
            {impact.remaining > 0 ? (
              <>
                {" "}
                You&apos;d still owe{" "}
                <span className="font-medium text-foreground">
                  {impact.remaining} check-in{impact.remaining === 1 ? "" : "s"}
                </span>
                , and the stake stands.
              </>
            ) : (
              <> Nothing else would be due.</>
            )}
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The breakdown: one block per habit, its affected cycles underneath.
 *
 * Habits you'd sit out of come first, because that's the one with a
 * consequence — no result and no stake — and the one nobody should meet by
 * surprise. Within a habit the cycles read forward in time, so a repeating
 * one tells a story: in for this one, out of the next.
 */
export function TimeOffImpact({
  groups,
  untouched,
}: {
  groups: readonly HabitImpactGroup[];
  /** Habits the stretch doesn't reach, counted so their absence isn't ambiguous. */
  untouched: number;
}) {
  if (groups.length === 0 && untouched === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No habits running over those dates.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.challengeId} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium">
              {group.name}
            </span>
            {group.repeating && (
              <span className="shrink-0 text-xs text-muted-foreground">
                repeats
              </span>
            )}
          </div>
          {group.cycles.map((impact) => (
            <CycleRow key={impact.challenge.id} impact={impact} />
          ))}
        </div>
      ))}
      {untouched > 0 && (
        <p className="text-xs text-muted-foreground">
          {untouched} other habit{untouched === 1 ? "" : "s"}{" "}
          {untouched === 1 ? "isn't" : "aren't"} running over those dates.
        </p>
      )}
    </div>
  );
}
