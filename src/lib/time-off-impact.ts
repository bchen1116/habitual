import { awayBudget, cycleTimeOff } from "@/lib/away";
import { progressSummary } from "@/lib/progress";
import type { AwayRange, Challenge } from "@/lib/types";

export interface HabitImpact {
  challenge: Challenge;
  /** Whether this cycle is sat out entirely. */
  steppedOut: boolean;
  /** Days of this cycle the booking excuses. */
  daysOff: number;
  /** The cycle's ceiling, so "6 of 7 covered" is sayable. */
  budget: number;
  /** Check-ins still owed once the time off is honoured. */
  remaining: number;
  /** First and last excused day, for naming the stretch. */
  from: string | null;
  to: string | null;
}

/**
 * What a stretch of time off means, habit by habit.
 *
 * The half that was missing: the app already warned which habits a booking
 * would take you out of, and said nothing about the ones it wouldn't. Those
 * are the more dangerous half — a habit that covers your holiday still
 * expects every other day of the cycle, and "my time off was accepted" is
 * very easily read as "nothing is due from me". This names both, and for the
 * habits you stay in it says how many check-ins are still owed.
 *
 * Evaluated against the *whole* set of booked ranges rather than this one
 * alone, because the budget is a per-cycle total: two separate long weekends
 * can add up past a third of a short habit when neither would on its own, and
 * a preview that judged them one at a time would promise the wrong answer.
 */
export function habitImpacts(
  challenges: readonly Challenge[],
  ranges: readonly AwayRange[],
  focus: { start: string; end: string },
  joinedDateByChallenge: Readonly<Record<string, string | undefined>>,
  checkinYmdsByChallenge: Readonly<Record<string, readonly string[]>>,
  timezone: string
): HabitImpact[] {
  return challenges
    .filter(
      (c) =>
        c.status === "active" &&
        // Overlaps the stretch being described. A cycle that ends before it
        // starts is untouched; one that begins after it ends is too.
        c.endDate >= focus.start &&
        c.startDate <= focus.end
    )
    .map((challenge) => {
      const joinedDate = joinedDateByChallenge[challenge.id];
      const timeOff = cycleTimeOff(challenge, ranges, joinedDate);
      const summary = progressSummary(
        challenge,
        checkinYmdsByChallenge[challenge.id] ?? [],
        timezone,
        joinedDate,
        timeOff.days
      );
      return {
        challenge,
        steppedOut: timeOff.steppedOut,
        daysOff: timeOff.days.size,
        budget: awayBudget(challenge),
        remaining: Math.max(0, summary.total - summary.completed),
        from: timeOff.outFrom,
        to: timeOff.outTo,
      };
    })
    .filter((impact) => impact.daysOff > 0)
    .sort((a, b) => Number(b.steppedOut) - Number(a.steppedOut));
}
