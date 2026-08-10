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
 * They **stack, carry across repeats, and are spent deliberately.** Each one
 * sits in the balance (`badgesCarried` on the member doc) until it is applied
 * to a specific missed week — see lib/spares.ts — and only an applied spare
 * raises the miss allowance. Nothing is consumed on your behalf.
 *
 * That is a reversal. Spares used to be spent automatically, on the reasoning
 * that a reward you must remember to claim before a nightly job you can't see
 * is a trap. The trap is real and is answered rather than ignored: a spare can
 * be applied at any point up to grading — including the day or two after a
 * cycle ends, while adjudication's buffer is still running — an unapplied one
 * is never lost but rolls into the next cycle, and the habit page says plainly
 * when misses have gone past the allowance and spares are sitting unused.
 * What automatic spending cost was the thing the deliberate version buys: the
 * choice of whether to burn a week you earned on a week you didn't.
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
  memberJoinedDate?: string,
  away?: ReadonlySet<string>
): number {
  if (!canEarnBadges(challenge)) return 0;
  const fullTarget = challenge.frequency.target;
  // A week partly or wholly declared off is `prorated` (or asks for nothing
  // at all), so the existing full-target test already refuses it a spare —
  // you don't bank a reward for a week you sat out. No extra rule needed,
  // which is the point of routing time off through windowRequirement.
  return weeklyWindows(
    challenge,
    checkinYmds,
    today,
    memberJoinedDate,
    away
  ).filter(
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
  /** The habit's own skipDays, as configured. Always in force. */
  base: number;
  /** Unspent spares carried in from earlier cycles of this same habit. */
  carried: number;
  /** Spares earned in this cycle so far. */
  earned: number;
  /** Spares deliberately applied to missed weeks of this cycle. */
  applied: number;
  /** Spares still in the bank: carried + earned − applied. */
  available: number;
  /** What adjudication compares misses against: base + applied. */
  total: number;
}

/**
 * `carried` comes from the member doc — repeatChallengeAdmin and the
 * auto-repeat job roll each cycle's *unspent* balance forward, which is what
 * makes a spare usable in a future cycle without the adjudicator having to
 * walk the whole repeat chain.
 *
 * `total` is deliberately `base + applied` and not `base + available`: an
 * unapplied spare is a balance, not an allowance. It protects nothing until
 * it's spent, and a screen that counted it would be promising cover the
 * adjudicator won't give.
 */
export function skipAllowance(
  challenge: Challenge,
  checkinYmds: readonly string[],
  today: string,
  memberJoinedDate?: string,
  badgesCarried = 0,
  sparesApplied = 0,
  away?: ReadonlySet<string>
): SkipAllowance {
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
 * A spare committed to a week that was later salvaged — by backfilling a day
 * inside it — is never consumed, and rolls forward like any other unspent one.
 * Without this clamp, a member who applied three spares and ended up needing
 * one would have paid for all three.
 *
 * Mirrored in functions/src/badges.ts, which is the copy that decides money.
 */
export function sparesConsumed(
  missed: number,
  base: number,
  applied: number
): number {
  return Math.min(applied, Math.max(0, missed - base));
}
