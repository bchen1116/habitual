import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import { memberTimeOff } from "@/lib/away";
import type { AwayRange, Challenge } from "@/lib/types";

/**
 * Who is excused from a cycle, for everyone else in it to see.
 *
 * This exists because of a rules boundary rather than a preference. Declared
 * time off lives on `users/{uid}.awayRanges`, which firestore.rules makes
 * owner-only — so a client can compute its own time off and no one else's,
 * and the members list showed a member checking in 2 of 7 days while the app
 * had already excused them from five of those days. The creator's excusal was
 * visible (it's a field on the member doc) and a member's own booking wasn't,
 * which made two routes to the same state look like two different states.
 *
 * Read on the server with the Admin SDK, which bypasses those rules, and
 * scoped in three ways so opening a habit page doesn't become a way to read
 * other people's calendars:
 *
 * - **Callers must be a member of this challenge.** Not "signed in" — in it.
 * - **Only days inside this cycle**, so a fortnight in June is invisible from
 *   a habit that ends in May.
 * - **Only days, never the ranges themselves** — no start/end, no labels.
 *   What comes back is the same fact the UI states out loud ("excused this
 *   week"), at the granularity the progress bars need, and nothing further.
 *
 * Deliberately NOT a denormalised flag on the member doc. A stored copy has
 * to be rewritten by every path that creates a cycle — manual repeat, the
 * auto-repeat job, joining late — and the one that forgot would leave a
 * member silently mislabelled. Computing it per request from the source of
 * truth can't drift. It also keeps this display-only by construction:
 * adjudication reads the user docs itself (functions/src/adjudicate.ts), so
 * nothing here can ever decide money.
 */
export interface MemberTimeOff {
  /** Days of this cycle the habit doesn't ask this member for. */
  awayDays: string[];
  /** Out of the cycle entirely — booked past the budget, or excused by the creator. */
  steppedOut: boolean;
}

export class ChallengeTimeOffError extends Error {
  constructor(public code: "not-found" | "not-member") {
    super(code);
  }
}

export async function challengeTimeOffAdmin(
  callerUid: string,
  challengeId: string
): Promise<Record<string, MemberTimeOff>> {
  const db = getAdminDb();
  const snap = await db.collection("challenges").doc(challengeId).get();
  if (!snap.exists) throw new ChallengeTimeOffError("not-found");

  const data = snap.data()!;
  if (!((data.memberIds as string[]) ?? []).includes(callerUid)) {
    throw new ChallengeTimeOffError("not-member");
  }

  const challenge = { id: challengeId, ...data } as Challenge;
  const members = await db
    .collection("challenges")
    .doc(challengeId)
    .collection("members")
    .get();
  if (members.empty) return {};

  // One getAll rather than a read per member: a group of ten was ten
  // sequential round trips on a path that runs on every habit page view.
  const userSnaps = await db.getAll(
    ...members.docs.map((doc) => db.collection("users").doc(doc.id))
  );
  const rangesByUid = new Map<string, AwayRange[]>();
  for (const userSnap of userSnaps) {
    rangesByUid.set(
      userSnap.id,
      (userSnap.data()?.awayRanges as AwayRange[] | undefined) ?? []
    );
  }

  const result: Record<string, MemberTimeOff> = {};
  for (const memberDoc of members.docs) {
    const member = memberDoc.data();
    const timeOff = memberTimeOff(
      challenge,
      rangesByUid.get(memberDoc.id) ?? [],
      member.joinedDate as string | undefined,
      member.excluded === true
    );
    // Members with nothing excused are left out entirely, so the common
    // response is `{}` rather than a row of empties per person.
    if (timeOff.days.size === 0 && !timeOff.steppedOut) continue;
    result[memberDoc.id] = {
      awayDays: [...timeOff.days].sort(),
      steppedOut: timeOff.steppedOut,
    };
  }
  return result;
}
