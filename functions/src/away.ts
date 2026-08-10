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

/** The most of any one cycle that time off can excuse. */
export const AWAY_FRACTION = 0.25;

/** The most days this particular cycle will excuse, whatever was declared. */
export function awayBudget(challenge: {
  startDate: string;
  endDate: string;
}): number {
  return Math.floor(
    daysBetweenInclusive(challenge.startDate, challenge.endDate) * AWAY_FRACTION
  );
}

/**
 * Days of this cycle that time off actually excuses, for one member.
 *
 * Spent earliest-first when a declaration exceeds the budget, which is stable
 * (a given day's answer never changes as the cycle runs) and fails safe (a day
 * over budget is simply a day they were expected to show up).
 */
export function awayDaysFor(
  challenge: { startDate: string; endDate: string },
  ranges: readonly AwayRange[] | undefined,
  memberJoinedDate?: string
): Set<string> {
  const honoured = new Set<string>();
  if (!ranges || ranges.length === 0) return honoured;

  const start =
    memberJoinedDate && memberJoinedDate > challenge.startDate
      ? memberJoinedDate
      : challenge.startDate;
  if (start > challenge.endDate) return honoured;

  const budget = awayBudget(challenge);
  if (budget <= 0) return honoured;

  for (const ymd of awayDaysInOrder(ranges)) {
    if (ymd < start || ymd > challenge.endDate) continue;
    honoured.add(ymd);
    if (honoured.size >= budget) break;
  }
  return honoured;
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
