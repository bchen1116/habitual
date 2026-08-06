import { effectiveStart } from "@/lib/progress";
import type { Challenge } from "@/lib/types";

/**
 * Whether a day that was missed can still be logged after the fact.
 *
 * Backfilling is an honour-system escape hatch for the ordinary case of
 * having done the thing and forgotten to tap the button. It is deliberately
 * *not* an unrestricted rewrite of history, because check-ins are what
 * adjudication counts (`computeMissed` in functions/src/adjudicate.ts) — a
 * backfilled day moves money exactly like one logged on the day.
 *
 * So it is bounded, on every side, and every bound is here rather than spread
 * across the UI:
 *
 * - **The cycle must still be running.** Once graded, the result is settled
 *   and money has moved; letting someone edit their way to a different
 *   outcome afterwards would make a settled ledger a lie. `status` is the
 *   right test rather than the end date, because a cycle that has ended but
 *   isn't graded yet is still legitimately editable — that is the window the
 *   adjudication buffer deliberately leaves open.
 * - **Not before you were in it.** effectiveStart, not startDate, so someone
 *   who joined a group late can't claim the weeks before they arrived.
 * - **Not after it ended, and not today or later.** Today is a normal
 *   check-in; offering "backfill" for it would be two buttons doing one job,
 *   and a future date isn't a missed day at all.
 * - **Not a day already logged.** Check-ins are create-only in the rules, so
 *   this would fail at the server anyway; catching it here means the UI never
 *   offers an action that cannot succeed.
 *
 * The equivalent constraints exist in firestore.rules, which is what actually
 * enforces them — this predicate exists so the interface only ever offers
 * what the server would accept.
 */
export function canBackfill(
  challenge: Challenge,
  ymd: string,
  today: string,
  checkedInYmds: readonly string[] | ReadonlySet<string>,
  memberJoinedDate?: string
): boolean {
  if (challenge.status !== "active") return false;
  if (ymd < effectiveStart(challenge, memberJoinedDate)) return false;
  if (ymd > challenge.endDate) return false;
  if (ymd >= today) return false;

  const done =
    checkedInYmds instanceof Set ? checkedInYmds : new Set(checkedInYmds);
  return !done.has(ymd);
}
