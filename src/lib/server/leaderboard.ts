import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { collectChainCycles, walkChainWith, type ChainReader } from "@/lib/chain-core";
import { longestStreak, streakRun } from "@/lib/streak";
import { yyyymmddUTC } from "@/lib/server/challenge-admin";
import type { Challenge, LeaderboardVisibility } from "@/lib/types";

/**
 * Leaderboard ranking of everyone the viewer shares (or has shared) a habit
 * with, by streak.
 *
 * Why this is server-side at all: firestore.rules makes `users/{uid}`
 * owner-only and gates every challenge/member/checkin read on co-membership,
 * so a browser can only ever see a peer's streak *inside habits it shares
 * with them* — a friend mid-90-day-run would render as "3" if the shared
 * habit is 3 days old, and two viewers would disagree about the same person.
 * Only the Admin SDK sees enough to produce a real number. This follows the
 * same "Admin SDK behind session verification in a route handler" pattern as
 * lib/server/challenge-admin.ts rather than a Cloud Function, which also lets
 * it reuse lib/streak.ts instead of duplicating it into functions/.
 *
 * The visibility rule, per product decision: a person's streak as shown to a
 * given viewer covers
 *     their public habits ∪ their private habits the viewer is also in.
 * The public half is viewer-independent, so it's cached per user per day; only
 * the private delta is per-viewer, and it's bounded by the viewer's own habit
 * list.
 */

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  currentStreak: number;
  longestStreak: number;
  isSelf: boolean;
}

interface StreakPair {
  currentStreak: number;
  longestStreak: number;
}

/**
 * Cap on how many peers get a fresh (uncached) recompute in one request. A
 * cold board for a well-connected user would otherwise do an unbounded amount
 * of work in a single request; instead the stalest few are refreshed and the
 * rest serve their previous value, converging over subsequent loads. Logged
 * when it bites, so a silently-partial board is never mistaken for a complete
 * one.
 */
const MAX_RECOMPUTES_PER_REQUEST = 12;

function adminChainReader(db: Firestore): ChainReader {
  return {
    async getChallenge(id) {
      const snap = await db.collection("challenges").doc(id).get();
      if (!snap.exists) return null;
      return { id: snap.id, ...snap.data() } as Challenge;
    },
    async getCheckinYmds(challengeId, uid) {
      const snap = await db
        .collection("challenges")
        .doc(challengeId)
        .collection("checkins")
        .where("uid", "==", uid)
        .get();
      return snap.docs.map((d) => d.data().localDate as string);
    },
  };
}

/**
 * Every challenge a user belongs to, any status. A lone `array-contains`
 * needs only the auto-created single-field index, so unlike
 * activeChallengesQuery/completedChallengesQuery (which filter by status and
 * lean on the composite index) this also picks up `cancelled` ones without a
 * new index entry.
 */
async function challengesForUser(db: Firestore, uid: string): Promise<Challenge[]> {
  const snap = await db
    .collection("challenges")
    .where("memberIds", "array-contains", uid)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Challenge);
}

function isPrivate(challenge: Challenge): boolean {
  return challenge.visibility === "private";
}

/**
 * A habit's own longest run, measured over its whole repeat-chain as one
 * continuous timeline rather than per-cycle. Cycles in a chain are contiguous
 * whole weeks by construction (repeatChallengeAdmin starts the next cycle at
 * endDate+1, and durations are whole weeks), so a synthetic challenge spanning
 * the earliest start to this cycle's end keeps the weekly window grid aligned
 * while letting a run cross cycle boundaries.
 */
async function chainLongestStreak(
  reader: ChainReader,
  challenge: Challenge,
  uid: string,
  today: string
): Promise<number> {
  const cycles = await collectChainCycles(reader, challenge);
  if (cycles.length === 1) {
    const ymds = await reader.getCheckinYmds(challenge.id, uid);
    return longestStreak(challenge, ymds, today);
  }

  const allYmds: string[] = [];
  for (const cycle of cycles) {
    allYmds.push(...(await reader.getCheckinYmds(cycle.id, uid)));
  }
  // cycles is newest-first (collectChainCycles walks backward), so the last
  // entry is the oldest cycle and holds the chain's true start.
  const oldest = cycles[cycles.length - 1];
  const spanning: Challenge = {
    ...challenge,
    startDate: oldest.startDate,
    // A chain-wide "best ever" is a historical record; a mid-chain skip-days
    // edit shouldn't erase it, matching streak.ts's stated position that
    // streakResetAt floors the *live* streak only.
    streakResetAt: null,
  };
  return longestStreak(spanning, allYmds, today);
}

/** Best current + best all-time across a given set of habits. */
async function computeStreaks(
  db: Firestore,
  uid: string,
  challenges: Challenge[],
  today: string
): Promise<StreakPair> {
  const reader = adminChainReader(db);
  let currentBest = 0;
  let longestBest = 0;

  for (const challenge of challenges) {
    const ymds = await reader.getCheckinYmds(challenge.id, uid);
    const run = streakRun(challenge, ymds, today);
    // Chain-aware, so this matches the number the user's own hero shows.
    const chained =
      run.reachesFloor && !challenge.streakResetAt && challenge.repeatedFromId
        ? run.streak + (await walkChainWith(reader, challenge, uid))
        : run.streak;
    currentBest = Math.max(currentBest, chained);
    longestBest = Math.max(
      longestBest,
      await chainLongestStreak(reader, challenge, uid, today)
    );
  }

  return { currentStreak: currentBest, longestStreak: longestBest };
}

/**
 * A user's streak over their PUBLIC habits only — identical for every viewer,
 * so it's cached in `userStreakStats/{uid}` (server-only per firestore.rules).
 *
 * The cache key is a date, not just a timestamp: a *current* streak decays
 * with the calendar even when nobody writes anything, so yesterday's number is
 * wrong today no matter how recently it was computed.
 */
async function getPublicStats(
  db: Firestore,
  uid: string,
  today: string,
  budget: { remaining: number }
): Promise<StreakPair> {
  const ref = db.collection("userStreakStats").doc(uid);
  const snap = await ref.get();
  const cached = snap.data();

  if (cached && cached.computedFor === today) {
    return {
      currentStreak: (cached.currentStreak as number) ?? 0,
      longestStreak: (cached.longestStreak as number) ?? 0,
    };
  }

  if (budget.remaining <= 0) {
    // Serve a stale figure rather than blowing the request budget. All-time is
    // still valid (it only ever grows); the current streak may be a day out.
    if (cached) {
      return {
        currentStreak: (cached.currentStreak as number) ?? 0,
        longestStreak: (cached.longestStreak as number) ?? 0,
      };
    }
    return { currentStreak: 0, longestStreak: 0 };
  }
  budget.remaining--;

  const all = await challengesForUser(db, uid);
  const stats = await computeStreaks(
    db,
    uid,
    all.filter((c) => !isPrivate(c)),
    today
  );

  await ref.set(
    { ...stats, computedFor: today, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return stats;
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  /** True when the viewer has opted out — they see their own board regardless. */
  viewerHidden: boolean;
}

export async function getLeaderboard(viewerUid: string): Promise<LeaderboardResult> {
  const db = getAdminDb();
  const today = yyyymmddUTC(new Date());

  const viewerChallenges = await challengesForUser(db, viewerUid);

  // "Anyone I have or have had a habit with" — any status, so a long-finished
  // or even cancelled group habit still counts as a shared history.
  const peerUids = new Set<string>([viewerUid]);
  for (const challenge of viewerChallenges) {
    for (const uid of challenge.memberIds ?? []) peerUids.add(uid);
  }

  // The viewer-specific half: private habits the viewer is inside. Their
  // members' streaks within these lift what the viewer sees, and nobody
  // outside them is affected.
  const sharedPrivate = viewerChallenges.filter(isPrivate);

  const budget = { remaining: MAX_RECOMPUTES_PER_REQUEST };
  const uids = [...peerUids];

  let viewerHidden = false;

  const entries = await Promise.all(
    uids.map(async (uid): Promise<LeaderboardEntry | null> => {
      // Admin SDK read: the viewer cannot read this doc themselves
      // (users/{uid} is owner-only), so the route returning just these display
      // fields for actual peers is the entire exposure — the same deliberate
      // server-mediated copy as toVenmoUsername on ledger entries.
      //
      // Read first, before any streak work: someone who opted out shouldn't
      // cost anything to skip.
      const userSnap = await db.collection("users").doc(uid).get();
      const user = userSnap.data();
      if (!user) return null; // deleted account still listed in an old memberIds

      const isSelf = uid === viewerUid;
      const hidden =
        (user.leaderboardVisibility as LeaderboardVisibility | undefined) === "hidden";
      if (isSelf) {
        viewerHidden = hidden;
      } else if (hidden) {
        // Account-level opt-out (users/{uid}.leaderboardVisibility). Strictly
        // outward-facing: they still see their own board, and they still see
        // everyone else — they just don't appear on anyone else's.
        return null;
      }

      const publicStats = await getPublicStats(db, uid, today, budget);

      let stats = publicStats;
      const theirSharedPrivate = sharedPrivate.filter((c) =>
        (c.memberIds ?? []).includes(uid)
      );
      if (theirSharedPrivate.length > 0) {
        const privateStats = await computeStreaks(db, uid, theirSharedPrivate, today);
        stats = {
          currentStreak: Math.max(publicStats.currentStreak, privateStats.currentStreak),
          longestStreak: Math.max(publicStats.longestStreak, privateStats.longestStreak),
        };
      }

      return {
        uid,
        displayName: (user.displayName as string | undefined) ?? "Someone",
        username: (user.username as string | undefined) ?? null,
        photoURL: (user.photoURL as string | undefined) ?? null,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        isSelf,
      };
    })
  );

  if (budget.remaining <= 0) {
    console.warn(
      `leaderboard for ${viewerUid}: hit the recompute cap, some entries served stale`
    );
  }

  return {
    entries: entries
      .filter((e): e is LeaderboardEntry => e !== null)
      .sort(
        (a, b) =>
          b.currentStreak - a.currentStreak ||
          b.longestStreak - a.longestStreak ||
          a.displayName.localeCompare(b.displayName)
      ),
    // So the board can tell you *you're* the reason friends don't see you,
    // rather than leaving you to wonder.
    viewerHidden,
  };
}
