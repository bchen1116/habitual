import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import type {
  ActivitySnapshot,
  Challenge,
  CheckinRecord,
} from "@/lib/types";

/**
 * A challenge document as plain data, safe to hand to a client component.
 *
 * Field by field rather than a spread of `d.data()`, and that is the whole
 * point of it. A Firestore Timestamp is a class instance, and React throws
 * when one crosses the server/client boundary — and challenge documents do
 * carry them: `createdAt` always, and `adjudicatedAt` once graded
 * (functions/src/adjudicate.ts). A spread happens to work today only because
 * this query filters to `status == "active"`, which excludes every document
 * that has the second one. That is a coincidence, not a guarantee, and the
 * failure it is one field away from is a crashed dashboard with an
 * unhelpful serialisation error.
 *
 * `createdAt` is nulled rather than converted because nothing on the client
 * reads it off a Challenge. If something ever needs it, send millis.
 */
function toPlainChallenge(
  id: string,
  data: FirebaseFirestore.DocumentData
): Challenge {
  return {
    id,
    name: data.name,
    description: data.description ?? null,
    createdBy: data.createdBy,
    mode: data.mode,
    forfeitType: data.forfeitType,
    charityName: data.charityName ?? null,
    joinCode: data.joinCode ?? null,
    joinPolicy: data.joinPolicy ?? null,
    joinClosed: data.joinClosed ?? null,
    visibility: data.visibility ?? null,
    maxMembers: data.maxMembers ?? null,
    streakResetAt: data.streakResetAt ?? null,
    repeatedFromId: data.repeatedFromId ?? null,
    repeatedToId: data.repeatedToId ?? null,
    autoRepeat: data.autoRepeat ?? null,
    weeksBefore: data.weeksBefore ?? null,
    frequency: {
      type: data.frequency?.type,
      target: data.frequency?.target,
    },
    skipDays: data.skipDays,
    stakeAmount: data.stakeAmount,
    startDate: data.startDate,
    endDate: data.endDate,
    status: data.status,
    memberIds: data.memberIds ?? [],
    createdAt: null,
  };
}

/**
 * The viewer's live habits and their own check-ins, read on the server.
 *
 * This exists to delete a waterfall, not to replace the listeners. Every page
 * in this app used to render as an empty shell, ship ~300 KB of Firebase SDK,
 * boot it, authenticate, and only then ask for data — so the first thing
 * anybody saw was a skeleton whose content was still four sequential steps
 * away. The same reads take one parallel hop from a server that is already
 * holding an authenticated Admin connection.
 *
 * The client hooks still subscribe exactly as before; they just start from
 * this instead of from null, so the first paint has real content and the
 * listeners' job narrows to keeping it current.
 *
 * Two things this must not get wrong, because the client will otherwise
 * disagree with the server for one frame and visibly correct itself:
 *
 * - The same sort as the client (`startDate`), or habits reorder on hydration.
 * - The same per-user filter. The client reads its own check-ins only, and so
 *   does this — `where("uid", "==", uid)`, which is also the query shape the
 *   client should adopt (see the read-amplification task).
 *
 * Returns null on failure rather than throwing. A page that can't prefetch is
 * a page that renders its normal loading state and lets the client fetch, and
 * that is a far better outcome than a 500 on a habit tracker.
 */
export async function getActiveChallengeActivity(
  uid: string
): Promise<ActivitySnapshot | null> {
  try {
    const db = getAdminDb();

    const [challengeSnap, userSnap] = await Promise.all([
      db
        .collection("challenges")
        .where("memberIds", "array-contains", uid)
        .where("status", "==", "active")
        .get(),
      db.collection("users").doc(uid).get(),
    ]);

    const challenges: Challenge[] = challengeSnap.docs
      .map((d) => toPlainChallenge(d.id, d.data()))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    // Per habit, in parallel — these are independent, and done sequentially
    // they would reintroduce the latency this function exists to remove.
    const perChallenge = await Promise.all(
      challenges.map(async (challenge) => {
        const [checkins, member] = await Promise.all([
          db
            .collection("challenges")
            .doc(challenge.id)
            .collection("checkins")
            .where("uid", "==", uid)
            .get(),
          db
            .collection("challenges")
            .doc(challenge.id)
            .collection("members")
            .doc(uid)
            .get(),
        ]);
        const records: CheckinRecord[] = checkins.docs.map((d) => {
          const data = d.data();
          return {
            localDate: data.localDate as string,
            completedAtMs: data.completedAt?.toMillis?.() ?? null,
          };
        });
        return {
          id: challenge.id,
          records,
          joinedDate: member.data()?.joinedDate as string | undefined,
        };
      })
    );

    const timezone = (userSnap.data()?.timezone as string | undefined) ?? null;

    // No stored timezone, no prefetch — deliberately, and this is the one case
    // where seeding would be worse than not seeding.
    //
    // Everything the seed feeds is date-dependent: the greeting, `todayYmd`,
    // which habits count as live, every week strip. Without a stored zone the
    // client falls back to the *browser's* timezone and the server would fall
    // back to its own, so the two would render different days and React would
    // hydrate onto a mismatch. That risk is new: before this prefetch the
    // server rendered a skeleton and had no dates to be wrong about.
    //
    // users/{uid}.timezone is written at sign-up (lib/user.ts), so this is a
    // legacy-account case, and the cost is only that those accounts keep the
    // behaviour everyone had until now.
    if (!timezone) return null;

    return {
      challenges,
      checkinsByChallenge: Object.fromEntries(
        perChallenge.map((c) => [c.id, c.records])
      ),
      joinedDateByChallenge: Object.fromEntries(
        perChallenge.map((c) => [c.id, c.joinedDate])
      ),
      timezone,
      // Field-by-field like everything else here: a stored range is a plain
      // {start, end, label} object with no Timestamp in it, but reading it
      // through the same projection keeps that a checked property rather than
      // an assumption the RSC boundary would fail on later.
      awayRanges: (
        (userSnap.data()?.awayRanges as
          | { start: string; end: string; label?: string | null }[]
          | undefined) ?? []
      ).map((range) => ({
        start: range.start,
        end: range.end,
        label: range.label ?? null,
      })),
    };
  } catch (err) {
    console.error("activity prefetch failed; falling back to client fetch:", err);
    return null;
  }
}
