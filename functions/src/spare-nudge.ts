import { computeMissed } from "./adjudicate";
import { canEarnBadges, effectiveSkipDays, type BadgeChallenge } from "./badges";

/**
 * "You can still save this" — the one nudge that manual spares require.
 *
 * Spending a spare used to be automatic, so there was nothing to forget. Now
 * that it's a decision, there is exactly one moment where forgetting it costs
 * real money: a cycle that has ended short, with spares still banked, waiting
 * out the 39-hour adjudication buffer. The habit page says so plainly, but a
 * page nobody opens says nothing, and after grading it can't be undone.
 *
 * Deliberately one nudge and not a running commentary. It fires the morning
 * after a cycle's end date, which is the first moment every window is closed
 * and the shortfall is final, and still roughly a day before the earliest
 * possible grading. Nudging mid-cycle would mean warning about weeks that
 * aren't over about a total that will change.
 */
export interface SpareShortfall {
  /** Misses beyond base skips and already-applied spares. */
  atRisk: number;
  /** Spares still in the bank for this habit. */
  available: number;
}

/**
 * The decision itself, separated from the four reads it takes to reach —
 * so the one part that can be wrong in a way that costs someone money, or
 * sends a push that isn't true, can be exercised without a database.
 */
export function shortfallFrom(
  missed: number,
  allowance: { total: number; available: number }
): SpareShortfall | null {
  const atRisk = missed - allowance.total;
  if (atRisk <= 0) return null;
  // Only when the balance can actually cover it. Telling someone they're
  // three short with two spares left is a notification that the stake is
  // already gone, which helps nobody and can't be acted on — and every miss
  // has room for a spare (see spareRoom), so a balance this size always can
  // be placed.
  if (allowance.available < atRisk) return null;
  return { atRisk, available: allowance.available };
}

/**
 * Whether this member ended a cycle short with spares left over — and by how
 * much. Null when there's nothing to say, which is the overwhelming majority
 * of calls, so it short-circuits before touching the subcollections.
 */
export async function spareShortfall(
  challengeRef: FirebaseFirestore.DocumentReference,
  challenge: BadgeChallenge & { skipDays: number },
  uid: string,
  today: string
): Promise<SpareShortfall | null> {
  if (!canEarnBadges(challenge)) return null;

  const memberSnap = await challengeRef.collection("members").doc(uid).get();
  const member = memberSnap.data();
  if (!member) return null;
  const carried = Math.max(0, (member.badgesCarried as number | undefined) ?? 0);

  const [checkinsSnap, sparesSnap] = await Promise.all([
    challengeRef.collection("checkins").where("uid", "==", uid).get(),
    challengeRef.collection("spares").where("uid", "==", uid).get(),
  ]);
  const ymds = checkinsSnap.docs.map(
    (doc) => (doc.data() as { localDate: string }).localDate
  );
  const applied = sparesSnap.docs.reduce(
    (sum, doc) => sum + Math.max(0, (doc.data() as { count: number }).count),
    0
  );

  const joinedDate = member.joinedDate as string | undefined;
  const allowance = effectiveSkipDays(
    challenge,
    ymds,
    today,
    joinedDate,
    carried,
    applied
  );
  if (allowance.available <= 0) return null;

  return shortfallFrom(
    computeMissed(challenge, ymds, joinedDate).missed,
    allowance
  );
}

/** The push body. Names the number to spend, since that's the whole ask. */
export function spareNudgeBody(
  challengeName: string,
  { atRisk, available }: SpareShortfall
): string {
  return (
    `"${challengeName}" finished ${atRisk} short, and you have ` +
    `${available} spare skip${available === 1 ? "" : "s"} banked. Spend ` +
    `${atRisk} on the missed week${atRisk === 1 ? "" : "s"} before it's ` +
    `graded and your stake is safe.`
  );
}
