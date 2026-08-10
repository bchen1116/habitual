"use client";

import { daysBetweenInclusive, formatYmd } from "@/lib/dates";
import type { HabitImpact, HabitImpactGroup } from "@/lib/time-off-impact";

/** "this cycle", "next cycle", "the one after" — plainer than "cycle 3". */
function cycleLabel(index: number): string {
  if (index === 0) return "this cycle";
  if (index === 1) return "next cycle";
  return `cycle ${index + 1}`;
}

/**
 * One line per cycle, and only one.
 *
 * It used to explain itself: how many days the cycle covered, how many were
 * booked, that the stake stood, that nothing else was due. All true, and
 * together it read as an argument rather than an answer — six habits' worth
 * of it is a wall of text on a phone, and the two facts that matter were
 * buried in the middle of it.
 *
 * So: skipping, or still in and how much is left. The budget arithmetic is
 * what *produced* the answer, not the answer, and it isn't shown.
 */
function CycleRow({ impact }: { impact: HabitImpact }) {
  const cycleDays = daysBetweenInclusive(
    impact.challenge.startDate,
    impact.challenge.endDate
  );
  return (
    <div
      className={
        "rounded-md px-3 py-2 " +
        (impact.steppedOut ? "border border-dashed" : "border border-input")
      }
    >
      <p className="text-xs text-muted-foreground">
        {cycleLabel(impact.cycleIndex)} · {formatYmd(impact.challenge.startDate)}{" "}
        – {formatYmd(impact.challenge.endDate)}
        {/* Said out loud rather than implied by styling: a projected cycle is
            a prediction from the repeat rules, not a document that exists. */}
        {impact.cycleIndex > 0 && " · projected"}
      </p>
      <p className="mt-0.5 text-sm font-medium">
        {impact.steppedOut ? (
          <>Skipping this {cycleDays === 7 ? "week" : "cycle"}</>
        ) : (
          <>
            {impact.daysOff} day{impact.daysOff === 1 ? "" : "s"} skipped
            {impact.remaining > 0 && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {impact.remaining} check-in
                {impact.remaining === 1 ? "" : "s"} still required
              </span>
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
 * Habits you'd sit out of come first, and within a habit the cycles read
 * forward in time, so a repeating one tells a story — skipping this week,
 * skipping the next, back in for the one after.
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
