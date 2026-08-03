/**
 * How long a repeated cycle runs.
 *
 * Mirrors repeatDurationDays() in src/lib/duration.ts — this Cloud Function
 * shares no package with the Next app, the same deliberate duplication as
 * effectiveStart, windowRequirement and badgesEarnedIn. A test drives both
 * over the same inputs and asserts they agree, because a successor whose
 * length the app and the job disagreed about would be a habit whose stake
 * settles on a date nobody was shown.
 */

export const MIN_DURATION_WEEKS = 1;
export const MAX_DURATION_WEEKS = 52;

/**
 * Exactly as long as the cycle it repeats: a weekly habit rolls into the next
 * week, a four-week ("monthly") one into the next four weeks.
 *
 * Rounds and clamps rather than validating, so repeating can never be the
 * thing that fails — only data predating the whole-week rule reaches the
 * rounding at all.
 */
export function repeatDurationDays(previousDays: number): number {
  const weeks = Math.round(previousDays / 7);
  const clamped = Math.min(
    MAX_DURATION_WEEKS,
    Math.max(MIN_DURATION_WEEKS, Number.isFinite(weeks) ? weeks : MIN_DURATION_WEEKS)
  );
  return clamped * 7;
}
