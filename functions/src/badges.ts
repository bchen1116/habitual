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
 * A window earns a badge on two conditions, and it needs both.
 *
 * *It asked for the habit's full target.* A week prorated for a late joiner
 * (owing 2 of 5) is not a full week, and paying a badge for it would make
 * joining late the cheapest way to earn one.
 *
 * *All seven of its days have passed.* A quota cleared on the third day of a
 * week has not kept that week yet, and this is the number that raises the
 * miss allowance, so it should not credit one in progress.
 *
 * `today` is what makes the second condition expressible, and it is why this
 * function grew a parameter it previously did without: with no notion of now,
 * a window counted as soon as its check-ins existed. Adjudication passes the
 * run date, which the 39-hour buffer guarantees is past `endDate`, so every
 * window is closed by then and no settled result moves.
 */
export function badgesEarnedIn(
  challenge: BadgeChallenge,
  checkinYmds: readonly string[],
  today: string,
  memberJoinedDate?: string,
  away?: ReadonlySet<string>
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
    // Strictly before: while today *is* the last day, the week is still
    // running and can still be added to.
    if (windowEnd >= today) continue; // week not over yet
    const required = windowRequirement(
      fullTarget,
      windowStart,
      windowEnd,
      memberStart,
      away
    );
    // Waived, prorated by a late join, or shortened by declared time off —
    // none of them is a full week kept, and none earns a spare. One test
    // covers all three because they all reduce the same number.
    if (required !== fullTarget) continue;
    const count = checkinYmds.filter(
      (d) => d >= windowStart && d <= windowEnd && !away?.has(d)
    ).length;
    if (count >= fullTarget) badges++;
  }
  return badges;
}

/**
 * What a member's misses are actually compared against.
 *
 * `badgesCarried` is the *unspent* balance rolled forward by
 * repeatChallengeAdmin and the auto-repeat job, which is what lets a spare
 * earned in one cycle be spent in a later one without the adjudicator walking
 * the whole repeat chain. Spares never leave the habit that earned them.
 *
 * `total` is `base + applied`, not `base + available`. Spares are no longer
 * spent on a member's behalf: one protects a week only once it has been
 * deliberately committed to it (challenges/{cid}/spares — see
 * src/lib/spares.ts). A balance sitting unapplied is still theirs and rolls
 * forward, but it covers nothing here.
 *
 * Mirrors skipAllowance() in src/lib/badges.ts. This copy decides the money;
 * that one makes the promise the member sees.
 */
export function effectiveSkipDays(
  challenge: BadgeChallenge & { skipDays: number },
  checkinYmds: readonly string[],
  today: string,
  memberJoinedDate?: string,
  badgesCarried = 0,
  sparesApplied = 0,
  away?: ReadonlySet<string>
): {
  base: number;
  carried: number;
  earned: number;
  applied: number;
  available: number;
  total: number;
} {
  const base = challenge.skipDays ?? 0;
  const carried = Math.max(0, badgesCarried);
  const earned = badgesEarnedIn(
    challenge,
    checkinYmds,
    today,
    memberJoinedDate,
    away
  );
  const applied = Math.max(0, sparesApplied);
  return {
    base,
    carried,
    earned,
    applied,
    available: Math.max(0, carried + earned - applied),
    total: base + applied,
  };
}

/**
 * How many applied spares a cycle actually burns.
 *
 * Applying a spare authorises its use; grading decides whether it was needed.
 * A spare committed to a week later salvaged by a backfill is never consumed
 * and rolls forward unspent, which is also what stops an over-eager
 * application from costing more than the misses it was aimed at.
 *
 * Mirrors sparesConsumed() in src/lib/badges.ts.
 */
export function sparesConsumed(
  missed: number,
  base: number,
  applied: number
): number {
  return Math.min(applied, Math.max(0, missed - base));
}
