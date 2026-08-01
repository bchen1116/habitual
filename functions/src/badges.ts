import { addDaysYmd, daysBetweenInclusive } from "./dates";
import { windowRequirement } from "./adjudicate";

/**
 * Badges: a spare skip, earned by completing a whole week.
 *
 * Mirrors src/lib/badges.ts — this Cloud Function shares no package with the
 * Next app, the same deliberate duplication as windowRequirement and
 * effectiveStart. This copy decides the money; that one makes the promise the
 * member sees. A test drives both over the same fixtures and asserts they
 * agree, because a badge the app promised and the adjudicator ignored is a
 * forfeited stake.
 *
 * Derived, never stored: counted from check-ins that are already there, the
 * same way streaks are. Nothing to forge, nothing to drift.
 */

/** Weekly target at or above this is "every day" in practice — no slack to earn. */
export const MAX_BADGE_TARGET = 6;

export interface BadgeChallenge {
  frequency: { type: "daily" | "weekly_count"; target: number };
  startDate: string;
  endDate: string;
}

export function canEarnBadges(challenge: BadgeChallenge): boolean {
  return (
    challenge.frequency?.type === "weekly_count" &&
    challenge.frequency.target <= MAX_BADGE_TARGET
  );
}

/**
 * Badges earned within this challenge.
 *
 * A window counts only if it asked for the habit's full target — a week
 * prorated for a late joiner (owing 2 of 5) is not a full week, and paying a
 * badge for it would make joining late the cheapest way to earn one.
 */
export function badgesEarnedIn(
  challenge: BadgeChallenge,
  checkinYmds: readonly string[],
  memberJoinedDate?: string
): number {
  if (!canEarnBadges(challenge)) return 0;
  const fullTarget = challenge.frequency.target;
  const memberStart =
    memberJoinedDate && memberJoinedDate > challenge.startDate
      ? memberJoinedDate
      : challenge.startDate;

  const days = daysBetweenInclusive(challenge.startDate, challenge.endDate);
  const weeks = Math.floor(days / 7);
  let badges = 0;
  for (let w = 0; w < weeks; w++) {
    const windowStart = addDaysYmd(challenge.startDate, w * 7);
    const windowEnd = addDaysYmd(windowStart, 6);
    const required = windowRequirement(
      fullTarget,
      windowStart,
      windowEnd,
      memberStart
    );
    if (required !== fullTarget) continue; // waived or prorated — not a full week
    const count = checkinYmds.filter(
      (d) => d >= windowStart && d <= windowEnd
    ).length;
    if (count >= fullTarget) badges++;
  }
  return badges;
}

/**
 * What a member's misses are actually compared against.
 *
 * `badgesCarried` is the running total rolled forward by repeatChallengeAdmin,
 * which is what lets a badge earned in one cycle be spent in a later one
 * without the adjudicator walking the whole repeat chain. Badges never leave
 * the habit that earned them.
 */
export function effectiveSkipDays(
  challenge: BadgeChallenge & { skipDays: number },
  checkinYmds: readonly string[],
  memberJoinedDate?: string,
  badgesCarried = 0
): { base: number; carried: number; earned: number; total: number } {
  const base = challenge.skipDays ?? 0;
  const carried = Math.max(0, badgesCarried);
  const earned = badgesEarnedIn(challenge, checkinYmds, memberJoinedDate);
  return { base, carried, earned, total: base + carried + earned };
}
