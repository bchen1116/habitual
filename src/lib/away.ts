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
 * - and, because a partly-away week is `prorated`, it can't earn a spare —
 *   you don't bank a reward for a week you sat out.
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
 */

/** The most of any one cycle that time off can excuse. */
export const AWAY_FRACTION = 0.25;

/**
 * Days of this cycle that time off actually excuses, for one member.
 *
 * Only days inside the cycle *and* on or after this member's own start — a
 * holiday declared before they joined a group excuses nothing, because those
 * days were never theirs to miss.
 *
 * The budget is spent earliest-first when a declaration exceeds it. That is a
 * choice, and the alternative (refusing the whole range, or spreading it) is
 * worse: refusing means one short habit blocks a holiday from applying to a
 * long one, and spreading makes which days count depend on days that haven't
 * happened yet. Earliest-first is stable — the answer for a given day never
 * changes as the cycle goes on — and it fails safe, because a day over budget
 * is simply a day you're expected to show up.
 */
export function awayDaysFor(
  challenge: Pick<Challenge, "startDate" | "endDate">,
  ranges: readonly AwayRange[] | undefined,
  memberJoinedDate?: string
): Set<string> {
  const honoured = new Set<string>();
  if (!ranges || ranges.length === 0) return honoured;

  const start = effectiveStart(challenge as Challenge, memberJoinedDate);
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
 * `declared` above `honoured` is the case worth surfacing: someone declared
 * three weeks, this habit will excuse one, and nothing else on the screen
 * would ever tell them the other two are ordinary weeks they're expected to
 * turn up for.
 */
export interface AwaySummary {
  /** Days declared that fall inside this cycle and after the member's start. */
  declared: number;
  /** Days the cycle honours, after the budget. */
  honoured: number;
  /** The cycle's ceiling, so "1 of 3 — this habit allows 7 days" is sayable. */
  budget: number;
  /** Whether the budget cut the declaration short. */
  truncated: boolean;
}

export function awaySummary(
  challenge: Pick<Challenge, "startDate" | "endDate">,
  ranges: readonly AwayRange[] | undefined,
  memberJoinedDate?: string
): AwaySummary {
  const budget = awayBudget(challenge);
  const start = effectiveStart(challenge as Challenge, memberJoinedDate);
  const declared = (ranges ? awayDaysInOrder(ranges) : []).filter(
    (ymd) => ymd >= start && ymd <= challenge.endDate
  ).length;
  const honoured = Math.min(declared, budget);
  return { declared, honoured, budget, truncated: declared > honoured };
}
