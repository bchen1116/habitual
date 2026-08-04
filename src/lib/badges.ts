import { weeklyWindows } from "@/lib/progress";
import type { Challenge } from "@/lib/types";

/**
 * Badges: a spare skip, earned by completing a whole week.
 *
 * Only `weekly_count` habits below 7×/week can earn them. A daily habit has no
 * slack to earn slack with — every day is already required, so "completing a
 * week" and "not missing" are the same thing, and handing out a skip for it
 * would just be a discount on the terms.
 *
 * They are **derived, never stored**: counted from the check-ins that are
 * already there, the same way streaks are. A stored counter would need a write
 * path, a rules surface to stop it being forged, and would drift the first
 * time the two disagreed — and this number moves money, so it cannot drift.
 *
 * They are **scoped to one habit**. A badge earned in "Gym 5×" does nothing
 * for "Read 3×": the effort that earned it was that habit's, and letting them
 * pool would turn an easy habit into a subsidy for a hard one.
 *
 * They **stack**, and they are spent automatically — each one raises the miss
 * allowance by 1 at adjudication. No redeem button: a badge you have to
 * remember to spend before a nightly job you can't see is a trap, not a
 * reward.
 */

/** Weekly target at or above this is "every day" in practice — no slack to earn. */
export const MAX_BADGE_TARGET = 6;

export function canEarnBadges(challenge: Challenge): boolean {
  return (
    challenge.frequency?.type === "weekly_count" &&
    challenge.frequency.target <= MAX_BADGE_TARGET
  );
}

/**
 * Badges earned within this challenge, from its own check-ins.
 *
 * A window earns a badge on two conditions, and it needs both.
 *
 * *It asked for the habit's full target.* A week prorated for a late joiner
 * (owing 2 of 5) is not a full week, and paying a badge for it would make
 * joining late the cheapest way to earn one.
 *
 * *All seven of its days have passed.* This used to pay out the moment the
 * count was reached, on the reasoning that a met week can no longer be failed
 * so there was nothing left to wait for. True, and beside the point: it meant
 * a 3×/week habit checked in on Monday, Tuesday and Wednesday announced a
 * spare skip on Wednesday, having banked a reward for a week it was three
 * days into. What the badge is meant to recognise is a *week* kept, not a
 * quota cleared early — so the week has to actually be over.
 *
 * The distinction only ever affects the window in progress. Every earlier one
 * has closed, and by the time adjudication runs the whole challenge has, so
 * no settled result changes.
 */
export function badgesEarnedIn(
  challenge: Challenge,
  checkinYmds: readonly string[],
  today: string,
  memberJoinedDate?: string
): number {
  if (!canEarnBadges(challenge)) return 0;
  const fullTarget = challenge.frequency.target;
  return weeklyWindows(challenge, checkinYmds, today, memberJoinedDate).filter(
    (w) =>
      !w.prorated &&
      w.target === fullTarget &&
      w.count >= fullTarget &&
      // Strictly before: while today *is* the last day, the week is still
      // running and can still be added to.
      w.end < today
  ).length;
}

export interface SkipAllowance {
  /** The habit's own skipDays, as configured. */
  base: number;
  /** Badges carried in from earlier cycles of this same habit. */
  carried: number;
  /** Badges earned in this cycle so far. */
  earned: number;
  /** What adjudication actually compares misses against. */
  total: number;
}

/**
 * `carried` comes from the member doc — repeatChallengeAdmin rolls each
 * cycle's total forward, which is what makes a badge usable "in a future
 * event" without the adjudicator having to walk the whole repeat chain.
 */
export function skipAllowance(
  challenge: Challenge,
  checkinYmds: readonly string[],
  today: string,
  memberJoinedDate?: string,
  badgesCarried = 0
): SkipAllowance {
  const base = challenge.skipDays ?? 0;
  const carried = Math.max(0, badgesCarried);
  const earned = badgesEarnedIn(challenge, checkinYmds, today, memberJoinedDate);
  return { base, carried, earned, total: base + carried + earned };
}
