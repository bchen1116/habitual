import { addDaysYmd, daysBetweenInclusive } from "./dates";

/**
 * Time off: date ranges the user declared in advance, during which a habit
 * asks nothing of them.
 *
 * Mirrors src/lib/away.ts — this Cloud Function shares no package with the
 * Next app, the same deliberate duplication as windowRequirement,
 * effectiveStart and badgesEarnedIn. This copy decides the money; that one
 * makes the promise the member sees. A test drives both over the same
 * fixtures and asserts they agree, because a day the app showed as skipped
 * and the adjudicator counted as missed is a forfeited stake.
 *
 * The three rules that keep it from being an escape hatch — declared in
 * advance, budgeted per cycle, never retroactive to a settled result — are
 * documented in full on the app's copy.
 */

export interface AwayRange {
  start: string;
  end: string;
}

/** The most of any one cycle that time off can excuse while you stay in it. */
export const AWAY_FRACTION = 1 / 3;

/** The most days this particular cycle will excuse, whatever was declared. */
export function awayBudget(challenge: {
  startDate: string;
  endDate: string;
}): number {
  return Math.floor(
    daysBetweenInclusive(challenge.startDate, challenge.endDate) * AWAY_FRACTION
  );
}

export interface CycleTimeOff {
  /** Days of this cycle that ask nothing of this member. */
  days: Set<string>;
  /**
   * Whether the booking was long enough, relative to this cycle, that the
   * member sits it out — no result, and no ledger entry either way.
   */
  steppedOut: boolean;
  outFrom: string | null;
  outTo: string | null;
}

/**
 * What one member's booked time off means for one cycle.
 *
 * Within the budget the days are excused and the member stays in. Over it
 * they step out: every booked day is excused and adjudication writes them no
 * outcome and no ledger entry.
 *
 * Stepping out is the reason this isn't a simple cap. Truncating a booking to
 * the budget demanded that someone show up for the tail of a holiday they had
 * already declared, and the shorter the habit the more of the holiday it
 * insisted on — the exact case the feature exists for. Grading someone who
 * was present for one week of four against people who were there for all of
 * it isn't an option either, and in a pool it would hand them a share of the
 * others' money, so "out entirely" is the only honest third answer.
 *
 * Mirrors cycleTimeOff() in src/lib/away.ts. This copy decides the money.
 */
export function cycleTimeOff(
  challenge: { startDate: string; endDate: string },
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

  const start =
    memberJoinedDate && memberJoinedDate > challenge.startDate
      ? memberJoinedDate
      : challenge.startDate;
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

/** Just the excused days — the shape the progress and badge functions take. */
export function awayDaysFor(
  challenge: { startDate: string; endDate: string },
  ranges: readonly AwayRange[] | undefined,
  memberJoinedDate?: string
): Set<string> {
  return cycleTimeOff(challenge, ranges, memberJoinedDate).days;
}

/** Every declared day, ascending and deduplicated, so overlaps cost their union. */
function awayDaysInOrder(ranges: readonly AwayRange[]): string[] {
  const days = new Set<string>();
  for (const range of ranges) {
    if (!range?.start || !range?.end || range.end < range.start) continue;
    for (let ymd = range.start; ymd <= range.end; ymd = addDaysYmd(ymd, 1)) {
      days.add(ymd);
    }
  }
  return [...days].sort();
}

/** Away days inside an inclusive span. */
export function countAwayBetween(
  from: string,
  to: string,
  away?: ReadonlySet<string>
): number {
  if (!away || away.size === 0) return 0;
  let count = 0;
  for (let ymd = from; ymd <= to; ymd = addDaysYmd(ymd, 1)) {
    if (away.has(ymd)) count++;
  }
  return count;
}
