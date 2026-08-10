import { awayBudget, cycleTimeOff } from "@/lib/away";
import { addDaysYmd, daysBetweenInclusive } from "@/lib/dates";
import { repeatDurationDays } from "@/lib/duration";
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
  /**
   * 0 for the cycle that exists today, 1 for the one after it, and so on.
   * Anything above 0 is a projection — see projectedCycles.
   */
  cycleIndex: number;
}

/**
 * How far ahead to predict. A fortnight booked against a weekly habit lands in
 * two or three cycles; a year of bookings against a weekly habit would land in
 * fifty, which is a wall of text rather than an answer. The cap is generous
 * enough that it only ever bites on a booking far longer than any habit's own
 * budget would honour anyway.
 */
const MAX_PROJECTED_CYCLES = 6;

/**
 * The cycles a repeating habit *will* have, which don't exist yet.
 *
 * Auto-repeat creates the successor a day before the current cycle ends, so
 * for most of a cycle's life the next one is not a document anyone can read.
 * That made the preview quietly wrong in the commonest case it's wanted for:
 * "I'm away for a fortnight" against a weekly habit is mostly a question about
 * cycles that haven't been created.
 *
 * Predictable exactly, because a successor's dates are not a choice: it starts
 * the day after its predecessor ends and runs the same length
 * (repeatDurationDays — the same function the job and the Repeat button use,
 * so this can't drift from what actually gets written). Members carry over
 * with `joinedDate` set to the new start, which is why the projections below
 * need no join date: everyone is there from day one.
 *
 * Only for habits set to keep going. A habit repeated by hand might not be,
 * and a preview that promised cycles that never appear would be worse than
 * one that admits it can only see so far.
 */
export function projectedCycles(
  challenge: Challenge,
  throughYmd: string
): Challenge[] {
  if (challenge.autoRepeat !== true) return [];
  if (challenge.status !== "active") return [];

  const cycles: Challenge[] = [];
  let startDate = addDaysYmd(challenge.endDate, 1);
  let length = repeatDurationDays(
    daysBetweenInclusive(challenge.startDate, challenge.endDate)
  );

  for (let i = 0; i < MAX_PROJECTED_CYCLES && startDate <= throughYmd; i++) {
    const endDate = addDaysYmd(startDate, length - 1);
    cycles.push({
      ...challenge,
      // Marked, not fabricated: nothing may write to this id, and a distinct
      // shape makes that obvious if one ever leaks into a call that expects a
      // real document.
      id: `${challenge.id}#projected${i + 1}`,
      startDate,
      endDate,
      weeksBefore:
        (challenge.weeksBefore ?? 0) +
        Math.floor(
          daysBetweenInclusive(challenge.startDate, challenge.endDate) / 7
        ) *
          (i + 1),
      repeatedFromId: challenge.id,
      repeatedToId: null,
    });
    startDate = addDaysYmd(endDate, 1);
    length = repeatDurationDays(length);
  }
  return cycles;
}

/**
 * What a stretch of time off means, habit by habit and cycle by cycle.
 *
 * The half that was missing at first: the app warned which habits a booking
 * would take you out of and said nothing about the ones it wouldn't. Those are
 * the more dangerous half — a habit that covers your holiday still expects
 * every other day of the cycle, and "my time off was accepted" is very easily
 * read as "nothing is due from me".
 *
 * The half that was missing after that: repeating habits. A fortnight booked
 * against a weekly habit is a question about three cycles, two of which are
 * still hypothetical.
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
  const rows: HabitImpact[] = [];

  for (const challenge of challenges) {
    if (challenge.status !== "active") continue;

    const cycles: { cycle: Challenge; index: number }[] = [
      { cycle: challenge, index: 0 },
      ...projectedCycles(challenge, focus.end).map((cycle, i) => ({
        cycle,
        index: i + 1,
      })),
    ];

    for (const { cycle, index } of cycles) {
      // Overlaps the stretch being described. A cycle that ends before it
      // starts is untouched; one that begins after it ends is too.
      if (cycle.endDate < focus.start || cycle.startDate > focus.end) continue;

      // Projections have no check-ins and no join date of their own: everyone
      // carried into a successor starts on its first day.
      const joinedDate = index === 0 ? joinedDateByChallenge[challenge.id] : undefined;
      const ymds = index === 0 ? (checkinYmdsByChallenge[challenge.id] ?? []) : [];

      const timeOff = cycleTimeOff(cycle, ranges, joinedDate);
      if (timeOff.days.size === 0) continue;

      const summary = progressSummary(cycle, ymds, timezone, joinedDate, timeOff.days);
      rows.push({
        challenge: cycle,
        steppedOut: timeOff.steppedOut,
        daysOff: timeOff.days.size,
        budget: awayBudget(cycle),
        remaining: Math.max(0, summary.total - summary.completed),
        from: timeOff.outFrom,
        to: timeOff.outTo,
        cycleIndex: index,
      });
    }
  }

  return rows;
}

export interface HabitImpactGroup {
  /** The real challenge's id — projections share it. */
  challengeId: string;
  name: string;
  /** Whether this habit rolls into the next cycle on its own. */
  repeating: boolean;
  /** Oldest cycle first, so the list reads forward in time. */
  cycles: HabitImpact[];
}

/**
 * One entry per habit, its affected cycles in order underneath.
 *
 * Grouped rather than flat because a repeating habit produces several rows
 * that are all the same habit, and a flat list of "Gym 3×" three times reads
 * as three habits. Habits you'd sit out of at all come first — that's the
 * consequence worth leading with.
 */
export function groupImpacts(impacts: readonly HabitImpact[]): HabitImpactGroup[] {
  const groups = new Map<string, HabitImpactGroup>();
  for (const impact of impacts) {
    const realId = impact.challenge.id.split("#")[0];
    const existing = groups.get(realId);
    if (existing) {
      existing.cycles.push(impact);
    } else {
      groups.set(realId, {
        challengeId: realId,
        name: impact.challenge.name,
        repeating: impact.challenge.autoRepeat === true,
        cycles: [impact],
      });
    }
  }
  for (const group of groups.values()) {
    group.cycles.sort((a, b) => a.cycleIndex - b.cycleIndex);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.cycles.some((c) => c.steppedOut)) -
      Number(a.cycles.some((c) => c.steppedOut))
  );
}
