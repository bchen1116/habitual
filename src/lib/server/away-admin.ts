import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { addDaysYmd, daysBetweenInclusive, todayYmd } from "@/lib/dates";
import { cycleTimeOff } from "@/lib/away";
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
  | "sitting-out"
  | "not-found";

export class AwayError extends Error {
  constructor(public code: AwayErrorCode) {
    super(code);
  }
}

/**
 * Carries the habit's name and end date, because "you can't delete this" is a
 * dead end and "you're sitting out Morning Run until Oct 12" is an answer.
 */
export class AwaySittingOutError extends AwayError {
  constructor(
    public challengeName: string,
    public challengeEndDate: string
  ) {
    super("sitting-out");
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
 * Withdraw a booked stretch.
 *
 * Allowed at essentially any time, including after it has started, because
 * deleting time off is the self-harming direction: it puts days *back* into
 * what a habit asks of you. It can never excuse a miss, never rescue a
 * streak, and never reduce a stake. "Book it and then think better of it" is
 * an ordinary thing to want, and refusing it left people with a list they
 * could add to but never prune.
 *
 * One exception, and it is a money hole rather than a tidiness rule.
 *
 * Sitting a cycle out is a *free option* if it can be reversed once the cycle
 * is under way. Book enough off to step out of a pool habit, keep the habit
 * anyway, watch how everyone else is doing, and then — if they're failing and
 * you're not — delete the range at the last moment and claim a share of their
 * stakes. Heads you win, tails you were never playing. So the decision to sit
 * out a particular cycle is fixed once that cycle begins; the range can be
 * deleted freely before it starts, and again once the cycle is over.
 *
 * Note what that exception is *not*. A range that merely excused some days
 * without stepping you out can always be deleted, mid-cycle included: doing
 * so hands those days back to the habit and can only cost you.
 *
 * Identified by `start`, which is unique because overlaps are refused.
 */
export async function removeAwayRangeAdmin(
  uid: string,
  start: string
): Promise<AwayRange[]> {
  const db = getAdminDb();
  const ref = db.collection("users").doc(uid);

  // Read before the transaction: this is a query rather than a document read,
  // and it only decides whether the delete is permitted. A challenge starting
  // in the instant between here and the commit would at worst let one delete
  // through that the next attempt refuses.
  const live = await db
    .collection("challenges")
    .where("memberIds", "array-contains", uid)
    .where("status", "==", "active")
    .get();

  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const timezone = (snap.data()?.timezone as string | undefined) ?? "UTC";
    const today = todayYmd(timezone);

    const existing = readRanges(snap.data());
    const target = existing.find((r) => r.start === start);
    if (!target) throw new AwayError("not-found");

    const next = existing.filter((r) => r.start !== start);

    // Would this put them back into a cycle they're already sitting out?
    const memberDocs = await Promise.all(
      live.docs.map((doc) => t.get(doc.ref.collection("members").doc(uid)))
    );
    for (const [i, challengeDoc] of live.docs.entries()) {
      const challenge = challengeDoc.data() as {
        name: string;
        startDate: string;
        endDate: string;
      };
      if (challenge.startDate > today) continue; // hasn't begun; still free
      const joinedDate = memberDocs[i].data()?.joinedDate as string | undefined;
      const before = cycleTimeOff(challenge, existing, joinedDate);
      const after = cycleTimeOff(challenge, next, joinedDate);
      if (before.steppedOut && !after.steppedOut) {
        throw new AwaySittingOutError(challenge.name, challenge.endDate);
      }
    }

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
