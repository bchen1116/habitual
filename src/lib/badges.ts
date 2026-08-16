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

/** Days in a week — and, since a spare needs a perfect one, the bar to clear. */
export const PERFECT_WEEK = 7;

/**
 * The highest weekly target that can still earn a spare.
 *
 * At 7 the target already *is* every day, so there would be nothing extra to
 * do — earning a spare would be indistinguishable from meeting the terms, and
 * the habit would simply come with a free skip. At 6 and below there is a gap
 * between what's asked and a perfect week, and closing it is the whole
 * transaction.
 */
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
 * *Every one of its seven days was checked in.* Not the habit's target — all
 * seven. A spare buys a missed day back, so earning one has to cost a day you
 * weren't obliged to do; otherwise a 5×/week habit hands out a skip for
 * simply being a 5×/week habit, and the fifth check-in of every week silently
 * becomes worth a sixth. Meeting the target is what keeps the stake. Beating
 * it — perfectly, all seven days — is what banks a spare.
 *
 * This is stricter than it was, deliberately. The old rule paid out at
 * `count >= target`, so the habit above earned a spare for exactly the work it
 * had already promised, and did it every single week: a 6-week habit met as
 * agreed accumulated 6 spares while never once exceeding its terms. That isn't
 * a reward for effort, it's an automatic discount on the skip allowance the
 * creator chose.
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
  // The prorated and full-target tests this used to carry are gone because
  // they can no longer fire, not because they stopped mattering. `count`
  // excludes days declared off, and every route to a shortened week — joining
  // into it, booking part of it off, a final stub week — leaves fewer than
  // seven countable days in it. Seven check-ins is therefore already the
  // statement that the week was whole and entirely kept.
  return weeklyWindows(
    challenge,
    checkinYmds,
    today,
    memberJoinedDate,
    away
  ).filter(
    (w) =>
      w.count >= PERFECT_WEEK &&
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
