import { addDaysYmd, daysBetweenInclusive } from "@/lib/dates";
import { effectiveStart } from "@/lib/progress";
import type { AwayRange, Challenge } from "@/lib/types";

/**
 * Time off: date ranges you declare in advance, during which a habit asks
 * nothing of you.
 *
 * Not a skip and not a spare. Both of those are *forgiveness for a miss* —
 * the day was required, you didn't do it, something covered you. Time off
 * means the day was never required at all, which is why it has to change the
 * denominator rather than the allowance:
 *
 * - a week you're away doesn't count as failed, so it can't break a streak;
 * - the progress bar asks for fewer check-ins rather than showing you behind;
 * - and, because a partly-away week has fewer than seven countable days, it
 *   can't be a perfect one and so can't earn a spare — you don't bank a
 *   reward for a week you sat out.
 *
 * Three rules keep it from being a way out of a stake, and each is enforced
 * where it can't be argued with:
 *
 * **Declared in advance** (lib/server/away-admin.ts). A range can only be
 * added before it starts, and can't be removed once it has. Without that,
 * "I was away" becomes something you remember on the day you were going to
 * fail — which is not time off, it's a refund.
 *
 * **Budgeted per cycle** (here). The declaration is global — one holiday,
 * not one per habit — but each habit honours at most `AWAY_FRACTION` of its
 * own length. A fortnight away is most of a two-week habit and a rounding
 * error on a year-long one, and only the habit knows which it is.
 *
 * **Never retroactive to a settled result.** Adjudication freezes the
 * outcome; nothing here recomputes one.
 *
 * Past the budget the habit lets go of you rather than clawing days back —
 * see `cycleTimeOff`.
 */

/**
 * The most of any one cycle that time off can excuse while you stay in it.
 *
 * A third: enough that an ordinary fortnight doesn't eject you from a
 * six-week habit, and not so much that a habit can be mostly sat out while
 * still being counted, ranked and staked.
 */
export const AWAY_FRACTION = 1 / 3;

export interface CycleTimeOff {
  /** Days of this cycle that ask nothing of this member. */
  days: Set<string>;
  /**
   * Whether the booking was long enough, relative to this cycle, that the
   * member sits it out rather than being partly excused.
   */
  steppedOut: boolean;
  /** The first and last booked day inside the cycle, when stepped out. */
  outFrom: string | null;
  outTo: string | null;
}

/**
 * What one member's booked time off means for one cycle.
 *
 * Only days inside the cycle *and* on or after this member's own start — a
 * holiday booked before they joined a group excuses nothing, because those
 * days were never theirs to miss.
 *
 * Two outcomes, and which one you get depends on the habit's length rather
 * than on anything you choose:
 *
 * **Within the budget: excused.** The days don't count, the member stays in
 * the habit, and everything else about the cycle is unchanged.
 *
 * **Over the budget: stepped out.** The member sits the cycle out — every
 * booked day is excused, and adjudication writes them no result and no ledger
 * entry either way.
 *
 * The second case replaced truncation, which was wrong in exactly the
 * situation this feature exists for. Truncating meant a fortnight booked
 * against a three-week habit excused a week and then demanded you show up for
 * the other seven days — days you had already said you would be away for, on
 * a habit too short to absorb the trip. It failed safe in the arithmetic and
 * absurd in practice: the shorter the habit, the more of your holiday it
 * insisted on.
 *
 * Stepping out is deliberately all-or-nothing about the *stake* rather than
 * pro-rata. A member present for one week of four cannot be graded against
 * people who were there for all of it, and in a pool they certainly cannot
 * take a share of their money for it — so the honest options were "in and
 * liable" or "out entirely", and one booked day past a third is a clear
 * enough line to put between them.
 *
 * The trade this accepts: someone who expects to fail a cycle could book
 * their way out of the stake in advance. It costs them more than a third of
 * the cycle, the streak, and any spare they'd have earned — and it has to be
 * decided before the days arrive rather than after they've gone badly, which
 * is the difference between opting out and wriggling out.
 */
export function cycleTimeOff(
  challenge: Pick<Challenge, "startDate" | "endDate">,
  ranges: readonly AwayRange[] | undefined,
  memberJoinedDate?: string
): CycleTimeOff {
  const none: CycleTimeOff = {
    days: new Set<string>(),
    steppedOut: false,
    outFrom: null,
    outTo: null,
  };
  if (!ranges || ranges.length === 0) return none;

  const start = effectiveStart(challenge as Challenge, memberJoinedDate);
  if (start > challenge.endDate) return none;

  const inCycle = awayDaysInOrder(ranges).filter(
    (ymd) => ymd >= start && ymd <= challenge.endDate
  );
  if (inCycle.length === 0) return none;

  const days = new Set(inCycle);
  if (inCycle.length <= awayBudget(challenge)) {
    return { days, steppedOut: false, outFrom: null, outTo: null };
  }
  return {
    days,
    steppedOut: true,
    outFrom: inCycle[0],
    outTo: inCycle[inCycle.length - 1],
  };
}

/**
 * A member the creator has excused from this cycle.
 *
 * Deliberately expressed as time off covering the whole cycle rather than as
 * a fourth state to branch on. Every consumer — required check-ins, misses,
 * streaks, weekly windows, badges, adjudication's ledger — already handles
 * "stepped out of this cycle" correctly, because booking too much time off
 * produces exactly the same situation. Reusing it means an exclusion cannot
 * be honoured in one place and forgotten in another, which is the failure
 * mode a new flag would invite.
 *
 * Whole cycles, not arbitrary dates, because a stake is per cycle: "out of
 * the pool and the stakes" has no smaller unit to attach to. A member doc is
 * already per cycle too, so the decision lives exactly where its consequence
 * does and cannot leak into the next one.
 */
export function excludedFromCycle(
  challenge: Pick<Challenge, "startDate" | "endDate">,
  memberJoinedDate?: string
): CycleTimeOff {
  const start = effectiveStart(challenge as Challenge, memberJoinedDate);
  const days = new Set<string>();
  for (let ymd = start; ymd <= challenge.endDate; ymd = addDaysYmd(ymd, 1)) {
    days.add(ymd);
  }
  return {
    days,
    steppedOut: true,
    outFrom: start <= challenge.endDate ? start : null,
    outTo: start <= challenge.endDate ? challenge.endDate : null,
  };
}

/**
 * What this cycle asks of one member, accounting for both routes out of it:
 * the creator excusing them, and their own booked time off.
 *
 * The creator's decision wins outright rather than merging. It already covers
 * the whole cycle, so nothing the member booked could add to it — and reading
 * it first means the answer doesn't depend on what they happen to have
 * booked, which is what "the creator took you out of this one" should mean.
 */
export function memberTimeOff(
  challenge: Pick<Challenge, "startDate" | "endDate">,
  ranges: readonly AwayRange[] | undefined,
  memberJoinedDate?: string,
  excluded?: boolean
): CycleTimeOff {
  return excluded
    ? excludedFromCycle(challenge, memberJoinedDate)
    : cycleTimeOff(challenge, ranges, memberJoinedDate);
}

/**
 * Just the excused days — the shape every progress, streak and badge function
 * takes. Whether the member also stepped out is a separate question, asked
 * only by the places that decide money or draw the habit page.
 */
export function awayDaysFor(
  challenge: Pick<Challenge, "startDate" | "endDate">,
  ranges: readonly AwayRange[] | undefined,
  memberJoinedDate?: string
): Set<string> {
  return cycleTimeOff(challenge, ranges, memberJoinedDate).days;
}

/** The most days this particular cycle will excuse, whatever was declared. */
export function awayBudget(
  challenge: Pick<Challenge, "startDate" | "endDate">
): number {
  const days = daysBetweenInclusive(challenge.startDate, challenge.endDate);
  return Math.floor(days * AWAY_FRACTION);
}

/**
 * Every declared day, ascending, deduplicated — so overlapping ranges cost
 * their union rather than being counted twice against the budget.
 *
 * Ranges are stored sorted and non-overlapping (away-admin.ts refuses an
 * overlap), so this is belt and braces rather than the main defence; it
 * matters because the budget is a *count*, and double-counting a day would
 * quietly shrink a holiday that was legitimately declared.
 */
function awayDaysInOrder(ranges: readonly AwayRange[]): string[] {
  const days = new Set<string>();
  for (const range of ranges) {
    if (range.end < range.start) continue;
    for (
      let ymd = range.start;
      ymd <= range.end;
      ymd = addDaysYmd(ymd, 1)
    ) {
      days.add(ymd);
    }
  }
  return [...days].sort();
}

/**
 * What a cycle is actually giving you, for the habit page to state plainly.
 *
 * `steppedOut` is the case worth surfacing loudest: it's the one where the
 * habit stops counting you altogether and no stake changes hands, and nothing
 * else on the screen would say so.
 */
export interface AwaySummary {
  /** Booked days that fall inside this cycle and after the member's start. */
  booked: number;
  /** The cycle's ceiling, so "9 days — this habit allows 9" is sayable. */
  budget: number;
  /** Whether the booking took them out of this cycle entirely. */
  steppedOut: boolean;
  outFrom: string | null;
  outTo: string | null;
}

export function awaySummary(
  challenge: Pick<Challenge, "startDate" | "endDate">,
  ranges: readonly AwayRange[] | undefined,
  memberJoinedDate?: string
): AwaySummary {
  const timeOff = cycleTimeOff(challenge, ranges, memberJoinedDate);
  return {
    booked: timeOff.days.size,
    budget: awayBudget(challenge),
    steppedOut: timeOff.steppedOut,
    outFrom: timeOff.outFrom,
    outTo: timeOff.outTo,
  };
}
