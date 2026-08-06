import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { todayYmd } from "@/lib/dates";
import { badgesEarnedIn, canEarnBadges } from "@/lib/badges";
import { weeklyWindows } from "@/lib/progress";
import { spareDocId, spareRoom } from "@/lib/spares";
import type { Challenge } from "@/lib/types";

export type SpareErrorCode =
  | "not-found"
  | "not-member"
  | "not-active"
  | "no-spares-here"
  | "unknown-week"
  | "week-not-missed"
  | "too-many-for-week"
  | "insufficient-balance";

export class SpareError extends Error {
  constructor(public code: SpareErrorCode) {
    super(code);
  }
}

/** How many spares one member has committed to one cycle, and where. */
async function readAppliedSpares(
  transaction: FirebaseFirestore.Transaction,
  challengeRef: FirebaseFirestore.DocumentReference,
  uid: string
): Promise<Map<string, number>> {
  const snap = await transaction.get(
    challengeRef.collection("spares").where("uid", "==", uid)
  );
  const byWindow = new Map<string, number>();
  for (const doc of snap.docs) {
    const { windowStart, count } = doc.data() as {
      windowStart: string;
      count: number;
    };
    byWindow.set(windowStart, Math.max(0, count));
  }
  return byWindow;
}

/**
 * Commit `count` spare skips to one missed week of a habit — or take them
 * back, with `count` 0.
 *
 * Server-side because the balance a spare is drawn against spans the whole
 * repeat chain: it lives on this cycle's member doc as `badgesCarried`, plus
 * whatever this cycle has earned since. Security rules can't aggregate across
 * documents, so there is no version of this a client could be trusted to
 * write, and the spares collection is closed to client writes entirely.
 *
 * Every bound is checked here rather than inherited from the interface:
 *
 * - **The cycle must still be gradeable.** `status`, not the end date — the
 *   day or two a habit spends ended-but-ungraded is exactly when someone
 *   realises they needed a spare, and it is still theirs to spend. Once
 *   adjudicated, money has moved.
 * - **The week must be over and short.** A week still running can be
 *   finished, and a spare spent on a week you then complete would be a refund
 *   the interface had to promise rather than a decision. `past-incomplete` is
 *   the same state the history renders in red.
 * - **Not more than that week was short by.** A spare covers a missed
 *   session; a week that came up one short has room for exactly one.
 * - **Not more than you have.** Counted across every window of this cycle, so
 *   two windows can't each spend the last spare.
 *
 * Taking one back is always allowed while the cycle is gradeable, and needs
 * none of those checks past the first: it only ever lowers the caller's own
 * allowance, so there is nothing to protect against.
 *
 * Runs in a transaction because the balance is read-then-written across
 * several documents — without it, two applications racing could each see the
 * same last spare.
 */
export async function setSpareAdmin(
  uid: string,
  challengeId: string,
  windowStart: string,
  count: number
): Promise<void> {
  const db = getAdminDb();
  const challengeRef = db.collection("challenges").doc(challengeId);
  const spareRef = challengeRef
    .collection("spares")
    .doc(spareDocId(windowStart, uid));

  // The member's own day, so a week that closed an hour ago in their timezone
  // is spendable now rather than after UTC catches up.
  const userSnap = await db.collection("users").doc(uid).get();
  const timezone = (userSnap.data()?.timezone as string | undefined) ?? "UTC";
  const today = todayYmd(timezone);

  await db.runTransaction(async (t) => {
    const challengeSnap = await t.get(challengeRef);
    if (!challengeSnap.exists) throw new SpareError("not-found");
    const challenge = {
      id: challengeSnap.id,
      ...challengeSnap.data(),
    } as Challenge;
    if (!challenge.memberIds?.includes(uid)) throw new SpareError("not-member");
    if (challenge.status !== "active") throw new SpareError("not-active");

    if (count <= 0) {
      t.delete(spareRef);
      return;
    }

    if (!canEarnBadges(challenge)) throw new SpareError("no-spares-here");

    const memberSnap = await t.get(challengeRef.collection("members").doc(uid));
    const joinedDate = memberSnap.data()?.joinedDate as string | undefined;
    const carried = Math.max(
      0,
      (memberSnap.data()?.badgesCarried as number | undefined) ?? 0
    );

    const checkinsSnap = await t.get(
      challengeRef.collection("checkins").where("uid", "==", uid)
    );
    const checkinYmds = checkinsSnap.docs.map(
      (doc) => (doc.data() as { localDate: string }).localDate
    );

    const window = weeklyWindows(challenge, checkinYmds, today, joinedDate).find(
      (w) => w.start === windowStart
    );
    if (!window) throw new SpareError("unknown-week");

    const applied = await readAppliedSpares(t, challengeRef, uid);
    // Room is measured against what's already on *other* windows, so raising
    // an existing application from 1 to 2 is bounded by the week's shortfall
    // rather than by the shortfall minus what it already holds.
    if (count > spareRoom(window, 0)) {
      throw new SpareError(
        window.state === "past-incomplete" ? "too-many-for-week" : "week-not-missed"
      );
    }

    let appliedElsewhere = 0;
    for (const [start, n] of applied) {
      if (start !== windowStart) appliedElsewhere += n;
    }
    const earned = badgesEarnedIn(challenge, checkinYmds, today, joinedDate);
    if (appliedElsewhere + count > carried + earned) {
      throw new SpareError("insufficient-balance");
    }

    t.set(spareRef, {
      uid,
      windowStart,
      count,
      appliedAt: FieldValue.serverTimestamp(),
    });
  });
}
