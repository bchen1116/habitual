import type { WindowEntry } from "@/lib/progress";
import type { Challenge, SpareApplication } from "@/lib/types";
import { canEarnBadges } from "@/lib/badges";

/**
 * Applying a spare skip to a week that was missed.
 *
 * Spares are earned per whole week kept (lib/badges.ts) and spent per whole
 * week missed. Both halves are weeks because only `weekly_count` habits can
 * earn them at all: a daily habit asks for every day there is, so it has no
 * slack to earn slack with, and its misses are days rather than shortfalls.
 * Nothing here ever has to handle a daily habit.
 *
 * These are the rules the server enforces (lib/server/spares-admin.ts) and the
 * interface obeys, so the app only ever offers an application that would be
 * accepted.
 */

/** The document id for one member's spares on one window. */
export function spareDocId(windowStart: string, uid: string): string {
  return `${windowStart}_${uid}`;
}

/** windowStart → spares committed there, for one member's applications. */
export function sparesByWindow(
  applications: readonly SpareApplication[]
): Map<string, number> {
  const byWindow = new Map<string, number>();
  for (const application of applications) {
    if (application.count > 0) {
      byWindow.set(application.windowStart, application.count);
    }
  }
  return byWindow;
}

/** Everything committed to this cycle, across all its windows. */
export function totalSparesApplied(
  applications: readonly SpareApplication[]
): number {
  return applications.reduce((sum, a) => sum + Math.max(0, a.count), 0);
}

/**
 * Whether this habit can take spare applications at all — the same gate as
 * earning them, plus a cycle that is still gradeable.
 *
 * `status`, not the end date, and for the same reason backfilling uses it: the
 * day or two between a cycle ending and adjudication running is exactly when
 * someone discovers they needed a spare, and it is still legitimately theirs
 * to spend. Once graded, money has moved and the result is settled.
 */
export function challengeTakesSpares(challenge: Challenge): boolean {
  return canEarnBadges(challenge) && challenge.status === "active";
}

/**
 * How many more spares this particular week could take.
 *
 * Bounded by its own shortfall, so nobody can park a balance on one bad week —
 * a spare covers a missed session, and a week that came up one short has room
 * for exactly one. Returns 0 for a week still in progress: it can still be
 * finished, and spending a spare on a week you then complete would be a
 * refund the interface had to promise rather than a decision.
 */
export function spareRoom(window: WindowEntry, appliedHere: number): number {
  if (window.state !== "past-incomplete") return 0;
  return Math.max(0, window.target - window.count - appliedHere);
}

/**
 * Misses this cycle that nothing is covering yet — the number that decides
 * whether the stake is at risk, and the one the habit page leads with when it
 * is.
 *
 * `skipsUsed` is the running shortfall across closed windows (lib/progress.ts);
 * base skips and applied spares are what stand against it.
 */
export function unprotectedMisses(
  skipsUsedSoFar: number,
  base: number,
  applied: number
): number {
  return Math.max(0, skipsUsedSoFar - base - applied);
}
