/**
 * How long a habit is allowed to run.
 *
 * Whole weeks only, which is a `weekly_count` requirement rather than a
 * stylistic one: the frequency grid is sequential 7-day windows anchored to
 * `startDate` (docs/02), so a partial final window would demand `target`
 * check-ins in fewer than 7 days — sometimes arithmetically impossible. It's
 * harmless for `daily`, so the rule is applied to both rather than branching.
 *
 * The ceiling is 52 weeks. There is deliberately no "runs forever" option:
 * the stake is only ever resolved at `endDate` (adjudicateEndedChallenges
 * queries `endDate <= cutoff`), so an open-ended habit would be one whose
 * money never moves — and the money is the whole mechanism. A habit that
 * genuinely shouldn't stop is served by Repeat instead, which starts the next
 * cycle the day after this one ends and carries the streak across the seam
 * (lib/chain-core.ts).
 */

export const MIN_DURATION_WEEKS = 1;
export const MAX_DURATION_WEEKS = 52;
export const MIN_DURATION_DAYS = MIN_DURATION_WEEKS * 7;
export const MAX_DURATION_DAYS = MAX_DURATION_WEEKS * 7; // 364

/** Whole weeks, within bounds — the one rule every entry point validates. */
export function isValidDurationDays(days: number): boolean {
  return (
    Number.isInteger(days) &&
    days % 7 === 0 &&
    days >= MIN_DURATION_DAYS &&
    days <= MAX_DURATION_DAYS
  );
}

/**
 * How long the next cycle of a repeated habit runs: exactly as long as the
 * one it repeats. A weekly habit rolls into the next week, a four-week
 * ("monthly") one into the next four weeks — no end date is ever asked for.
 *
 * Rounded and clamped rather than validated, so Repeat can never be the thing
 * that fails. Every current entry point already enforces whole weeks, so the
 * rounding only ever bites on data predating that rule; a habit whose stored
 * dates are corrupt still repeats, as the nearest sane length.
 *
 * Shared by the dialog's preview and repeatChallengeAdmin so the dates the
 * member is shown are the dates that get written.
 */
export function repeatDurationDays(previousDays: number): number {
  const weeks = Math.round(previousDays / 7);
  const clamped = Math.min(
    MAX_DURATION_WEEKS,
    Math.max(MIN_DURATION_WEEKS, Number.isFinite(weeks) ? weeks : MIN_DURATION_WEEKS)
  );
  return clamped * 7;
}

export function isValidDurationWeeks(weeks: number): boolean {
  return (
    Number.isInteger(weeks) &&
    weeks >= MIN_DURATION_WEEKS &&
    weeks <= MAX_DURATION_WEEKS
  );
}

/**
 * The shortcuts offered at creation. Not exhaustive by design — 52 chips
 * would be unusable, so anything else is typed into the weeks field beside
 * them. The month labels are approximations (13 weeks is 91 days, not a
 * calendar quarter); the exact date range is always shown underneath, which
 * is the number that actually governs.
 */
export const DURATION_PRESETS: { weeks: number; label: string }[] = [
  { weeks: 1, label: "1 week" },
  { weeks: 2, label: "2 weeks" },
  { weeks: 4, label: "4 weeks" },
  { weeks: 13, label: "3 months" },
  { weeks: 26, label: "6 months" },
  { weeks: 52, label: "1 year" },
];

/** "12 weeks", "1 week" — plain, for review copy and error messages. */
export function weeksLabel(weeks: number): string {
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}
