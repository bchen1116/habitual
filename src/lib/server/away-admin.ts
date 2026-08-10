import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { addDaysYmd, daysBetweenInclusive, todayYmd } from "@/lib/dates";
import type { AwayRange } from "@/lib/types";

/**
 * Declaring, and un-declaring, time off.
 *
 * Every rule here exists because time off reduces what a habit asks of you,
 * and habits move real money. Written server-side for the same reason spares
 * are: the one rule that matters most — *in advance* — is a comparison
 * against the user's own local date, and security rules only know UTC and
 * can't walk an array to find which element changed.
 */

/** The longest single stretch anyone can declare. A season, not a sabbatical. */
export const MAX_AWAY_RANGE_DAYS = 90;
/** How many separate stretches can be on the books at once. */
export const MAX_AWAY_RANGES = 12;
/** Optional recall label, kept short — it's a reminder, not a journal. */
export const MAX_AWAY_LABEL_LENGTH = 40;

export type AwayErrorCode =
  | "not-in-advance"
  | "backwards"
  | "too-long"
  | "too-many"
  | "overlaps"
  | "already-started"
  | "not-found";

export class AwayError extends Error {
  constructor(public code: AwayErrorCode) {
    super(code);
  }
}

function readRanges(data: FirebaseFirestore.DocumentData | undefined): AwayRange[] {
  const stored = data?.awayRanges as AwayRange[] | undefined;
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((r) => typeof r?.start === "string" && typeof r?.end === "string")
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Add a stretch of time off.
 *
 * **It must start in the future.** This is the rule the whole feature rests
 * on. Time off you can declare on the day — or after it — isn't time off, it's
 * a retroactive excuse for a day you already knew you'd missed, and it would
 * make every stake optional. `> today` in the user's own timezone, so the
 * boundary is the one they experience rather than UTC's.
 *
 * **It can't overlap one already on the books.** Overlapping ranges would
 * still cost their union against a habit's budget (awayDaysInOrder
 * deduplicates), so this changes no arithmetic — it exists so the list on
 * screen means what it looks like it means, and so "remove the range starting
 * on the 3rd" is never ambiguous.
 *
 * The bounds on length and count are ordinary sanity limits: they keep one
 * user document small and bounded, and 90 days is already far past what any
 * habit's own 25% budget would honour.
 */
export async function addAwayRangeAdmin(
  uid: string,
  start: string,
  end: string,
  label: string | null
): Promise<AwayRange[]> {
  const db = getAdminDb();
  const ref = db.collection("users").doc(uid);

  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const timezone = (snap.data()?.timezone as string | undefined) ?? "UTC";
    const today = todayYmd(timezone);

    if (end < start) throw new AwayError("backwards");
    if (start <= today) throw new AwayError("not-in-advance");
    if (daysBetweenInclusive(start, end) > MAX_AWAY_RANGE_DAYS) {
      throw new AwayError("too-long");
    }

    const existing = readRanges(snap.data());
    if (existing.length >= MAX_AWAY_RANGES) throw new AwayError("too-many");
    // Inclusive dates, so touching ranges (one ending the day the next starts)
    // overlap by a day and are rejected — a single longer range says the same
    // thing without the ambiguity.
    if (existing.some((r) => r.start <= end && start <= r.end)) {
      throw new AwayError("overlaps");
    }

    const next = [...existing, { start, end, label: label || null }].sort(
      (a, b) => a.start.localeCompare(b.start)
    );
    // set/merge rather than update: a user who has never written a profile
    // field has no document to update, and failing to declare a holiday
    // because of that would be an absurd way to lose a stake.
    t.set(ref, { awayRanges: next }, { merge: true });
    return next;
  });
}

/**
 * Withdraw a stretch that hasn't begun.
 *
 * Only one that hasn't begun, which is the mirror of declaring in advance
 * rather than an arbitrary restriction. Removing a range that has started
 * would make days already lived retroactively required — and in a group, it
 * would let someone quietly rewrite what their week asked of them after
 * seeing how it went. Nobody needs that: it can only ever make things worse
 * for the person doing it, and "can only hurt you" is not a safety argument
 * when the same edit changes what everyone else's pool is measured against.
 *
 * Identified by `start`, which is unique because overlaps are refused.
 */
export async function removeAwayRangeAdmin(
  uid: string,
  start: string
): Promise<AwayRange[]> {
  const db = getAdminDb();
  const ref = db.collection("users").doc(uid);

  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const timezone = (snap.data()?.timezone as string | undefined) ?? "UTC";
    const today = todayYmd(timezone);

    const existing = readRanges(snap.data());
    const target = existing.find((r) => r.start === start);
    if (!target) throw new AwayError("not-found");
    if (target.start <= today) throw new AwayError("already-started");

    const next = existing.filter((r) => r.start !== start);
    t.set(ref, { awayRanges: next }, { merge: true });
    return next;
  });
}

/**
 * The earliest date a new range may start: tomorrow, in the user's timezone.
 * Exported so the date picker can't offer a day the server would refuse.
 */
export function earliestAwayStart(timezone: string): string {
  return addDaysYmd(todayYmd(timezone), 1);
}
