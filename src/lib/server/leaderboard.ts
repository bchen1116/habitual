import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { collectChainCycles, walkChainWith, type ChainReader } from "@/lib/chain-core";
import { longestStreak, streakRun } from "@/lib/streak";
import { badgesEarnedIn } from "@/lib/badges";
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
  currentStreakWeeks: number;
  longestStreak: number;
  /** Spare skips earned by completing whole weeks — shown beside the streak. */
  badges: number;
  isSelf: boolean;
}

export interface StreakPair {
  currentStreak: number;
  /** Calendar span of the current streak, in whole weeks. */
  currentStreakWeeks: number;
  longestStreak: number;
  /**
   * Spare skips earned by completing whole weeks, across the habits in scope.
   * Summed over every cycle rather than walking the chain — challengesForUser
   * already returns ancestors, so earlier cycles are counted for free.
   */
  badges: number;
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

export function adminChainReader(db: Firestore): ChainReader {
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
    async getJoinedDate(challengeId, uid) {
      const snap = await db
        .collection("challenges")
        .doc(challengeId)
        .collection("members")
        .doc(uid)
        .get();
      return snap.data()?.joinedDate as string | undefined;
    },
  };
}

/**
 * `adminChainReader` with a per-request memo.
 *
 * Measured, not guessed: exactly half of every read inside computeStreaks was
 * a duplicate, at every chain depth. walkChainWith reads a cycle's challenge
 * doc, its check-ins and its join date to decide whether the streak carries;
 * chainLongestStreak then calls collectChainCycles and reads all of it again
 * to measure the all-time run. Nothing sat between them.
 *
 * Safe because everything it caches is immutable for the life of one request:
 * a challenge's terms, a member's joinedDate, and a past day's check-ins do
 * not change while the response is being assembled. It must therefore be
 * created per request and never at module scope, where it would go stale the
 * moment anyone checked in.
 *
 * The win compounds across peers on a shared board: a group habit's challenge
 * doc is read once for the whole leaderboard rather than once per member.
 */
/** Challenge docs a caller already holds, per memoized reader. */
const seedTables = new WeakMap<ChainReader, Map<string, Promise<unknown>>>();

/**
 * Hand a memoized reader challenge documents the caller has already fetched.
 * Pure saving: `challengesForUser` returns every cycle a member belongs to,
 * ancestors included, so without this the chain walk pays a round trip to
 * re-read a document already sitting in memory.
 */
export function seedChallenges(
  reader: ChainReader,
  challenges: readonly Challenge[]
): void {
  const cache = seedTables.get(reader);
  if (!cache) return;
  for (const challenge of challenges) {
    const key = `c:${challenge.id}`;
    if (!cache.has(key)) cache.set(key, Promise.resolve(challenge));
  }
}

export function memoizedChainReader(
  db: Firestore,
  /**
   * Challenge docs already in hand — `challengesForUser` returns every cycle
   * a member belongs to, ancestors included, so the chain walk's per-ancestor
   * `getChallenge` is a document we have already paid for. Seeding them turns
   * the walk's slowest part (sequential by nature: whether to look at the next
   * ancestor depends on this one's result) from a round trip per cycle into
   * memory lookups.
   */
  seed: readonly Challenge[] = []
): ChainReader {
  const inner = adminChainReader(db);
  const cache = new Map<string, Promise<unknown>>();
  for (const challenge of seed) {
    cache.set(`c:${challenge.id}`, Promise.resolve(challenge));
  }
  const memo = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit) return hit as Promise<T>;
    // The *promise* is cached, not the resolved value, so concurrent callers
    // for the same key share one round trip instead of racing to start two.
    const started = run();
    cache.set(key, started);
    return started;
  };
  const reader: ChainReader = {
    getChallenge: (id) => memo(`c:${id}`, () => inner.getChallenge(id)),
    getCheckinYmds: (cid, uid) =>
      memo(`k:${cid}:${uid}`, () => inner.getCheckinYmds(cid, uid)),
    getJoinedDate: (cid, uid) =>
      memo(`j:${cid}:${uid}`, () => inner.getJoinedDate(cid, uid)),
  };
  seedTables.set(reader, cache);
  return reader;
}

/** Admin `getAll` in chunks, so a well-connected board can't exceed its limits. */
async function getAllChunked(
  db: Firestore,
  refs: FirebaseFirestore.DocumentReference[]
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const CHUNK = 300;
  const out: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let i = 0; i < refs.length; i += CHUNK) {
    const slice = refs.slice(i, i + CHUNK);
    if (slice.length > 0) out.push(...(await db.getAll(...slice)));
  }
  return out;
}

/**
 * Every challenge a user belongs to, any status. A lone `array-contains`
 * needs only the auto-created single-field index, so unlike
 * activeChallengesQuery/completedChallengesQuery (which filter by status and
 * lean on the composite index) this also picks up `cancelled` ones without a
 * new index entry.
 */
export async function challengesForUser(
  db: Firestore,
  uid: string
): Promise<Challenge[]> {
  const snap = await db
    .collection("challenges")
    .where("memberIds", "array-contains", uid)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Challenge);
}

export function isPrivate(challenge: Challenge): boolean {
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
    return longestStreak(
      challenge,
      ymds,
      today,
      await reader.getJoinedDate(challenge.id, uid)
    );
  }

  // One round trip for the whole chain instead of one per cycle. Order is
  // irrelevant to both results below: longestStreak puts the dates into a Set,
  // and the join date is a minimum.
  const perCycle = await Promise.all(
    cycles.map(async (cycle) => ({
      ymds: await reader.getCheckinYmds(cycle.id, uid),
      joined: await reader.getJoinedDate(cycle.id, uid),
    }))
  );
  const allYmds = perCycle.flatMap((c) => c.ymds);
  // The earliest cycle they were actually in. A chain can reach back past
  // someone's own membership (the Admin SDK reads cycles they were never part
  // of), and the spanning challenge below starts at the oldest cycle either
  // way — so their effective start is the earliest join date on record, not
  // the chain's start.
  let joinedDate: string | undefined;
  for (const { joined } of perCycle) {
    if (joined && (!joinedDate || joined < joinedDate)) joinedDate = joined;
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
  return longestStreak(spanning, allYmds, today, joinedDate);
}

/**
 * Best current + best all-time across a given set of habits.
 *
 * `reader` is threaded in rather than built here so one memo spans a whole
 * request — the same challenge doc, join date and check-in set are otherwise
 * re-read for every habit, every peer, and every call.
 */
export async function computeStreaks(
  db: Firestore,
  uid: string,
  challenges: Challenge[],
  today: string,
  reader: ChainReader = memoizedChainReader(db)
): Promise<StreakPair> {
  // Habits are independent, so they resolve concurrently; the sequential loop
  // this replaces cost one full round trip of latency per habit.
  const perChallenge = await Promise.all(
    challenges.map(async (challenge) => {
      const [ymds, joinedDate] = await Promise.all([
        reader.getCheckinYmds(challenge.id, uid),
        // Their own start, so a habit they joined mid-week ranks the same way
        // it reads on their own dashboard.
        reader.getJoinedDate(challenge.id, uid),
      ]);
      const run = streakRun(challenge, ymds, today, joinedDate);
      // Chain-aware, so this matches the number the user's own hero shows.
      const carry =
        run.reachesFloor && !challenge.streakResetAt && challenge.repeatedFromId
          ? await walkChainWith(reader, challenge, uid)
          : { streak: 0, spanDays: 0 };
      return {
        chained: run.streak + carry.streak,
        weeks: Math.floor((run.spanDays + carry.spanDays) / 7),
        longest: await chainLongestStreak(reader, challenge, uid, today),
        badges: badgesEarnedIn(challenge, ymds, today, joinedDate),
      };
    })
  );

  let currentBest = 0;
  // Belongs to whichever habit produced currentBest, not the longest-running
  // habit overall — the board's header and subheader must describe the same
  // run, or "50 days / 10 weeks" would be two unrelated facts. Reduced in the
  // original order with a strict `>`, so the winner is the same habit the
  // sequential version picked.
  let currentBestWeeks = 0;
  let longestBest = 0;
  let badges = 0;
  for (const result of perChallenge) {
    badges += result.badges;
    if (result.chained > currentBest) {
      currentBest = result.chained;
      currentBestWeeks = result.weeks;
    }
    longestBest = Math.max(longestBest, result.longest);
  }

  return {
    currentStreak: currentBest,
    currentStreakWeeks: currentBestWeeks,
    longestStreak: longestBest,
    badges,
  };
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
  budget: { remaining: number; skipped: number },
  reader: ChainReader
): Promise<StreakPair> {
  const ref = db.collection("userStreakStats").doc(uid);
  const snap = await ref.get();
  const cached = snap.data();

  if (cached && cached.computedFor === today) {
    return {
      currentStreak: (cached.currentStreak as number) ?? 0,
      currentStreakWeeks: (cached.currentStreakWeeks as number) ?? 0,
      longestStreak: (cached.longestStreak as number) ?? 0,
      badges: (cached.badges as number) ?? 0,
    };
  }

  if (budget.remaining <= 0) {
    // Serve a stale figure rather than blowing the request budget. All-time is
    // still valid (it only ever grows); the current streak may be a day out.
    budget.skipped++;
    if (cached) {
      return {
        currentStreak: (cached.currentStreak as number) ?? 0,
        currentStreakWeeks: (cached.currentStreakWeeks as number) ?? 0,
        longestStreak: (cached.longestStreak as number) ?? 0,
        badges: (cached.badges as number) ?? 0,
      };
    }
    return { currentStreak: 0, currentStreakWeeks: 0, longestStreak: 0, badges: 0 };
  }
  budget.remaining--;

  const all = await challengesForUser(db, uid);
  // Their whole challenge list, ancestors included — seeding it means the
  // chain walk below never round-trips for a cycle document.
  seedChallenges(reader, all);
  const stats = await computeStreaks(
    db,
    uid,
    all.filter((c) => !isPrivate(c)),
    today,
    reader
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

  const budget = { remaining: MAX_RECOMPUTES_PER_REQUEST, skipped: 0 };
  const uids = [...peerUids];
  // One reader for the whole request: challenge docs are shared between every
  // member of a group habit, so this is read once for the board rather than
  // once per peer.
  // Seeded with the viewer's own challenges — every shared habit and every
  // ancestor cycle of one is already in hand.
  const reader = memoizedChainReader(db, viewerChallenges);

  let viewerHidden = false;

  // Admin SDK read: the viewer cannot read these docs themselves (users/{uid}
  // is owner-only), so the route returning just these display fields for
  // actual peers is the entire exposure — the same deliberate server-mediated
  // copy as toVenmoUsername on ledger entries.
  //
  // Fetched in one batched call rather than a `get()` per peer. Every peer's
  // doc is needed regardless (a name is needed to render them, and the
  // opt-out flag lives here), so this reads no more than before — it just
  // stops paying per-document round-trip overhead N times over.
  const userSnaps = await getAllChunked(
    db,
    uids.map((uid) => db.collection("users").doc(uid))
  );
  const usersByUid = new Map(userSnaps.map((snap) => [snap.id, snap.data()]));

  const entries = await Promise.all(
    uids.map(async (uid): Promise<LeaderboardEntry | null> => {
      const user = usersByUid.get(uid);
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

      const publicStats = await getPublicStats(db, uid, today, budget, reader);

      let stats = publicStats;
      const theirSharedPrivate = sharedPrivate.filter((c) =>
        (c.memberIds ?? []).includes(uid)
      );
      // Budgeted like the public half. This used to recompute in full on every
      // request for every peer sharing a private habit — uncached and
      // uncounted, so a cold board could quietly do far more work than the cap
      // claimed to allow.
      if (theirSharedPrivate.length > 0 && budget.remaining > 0) {
        budget.remaining--;
        const privateStats = await computeStreaks(
          db,
          uid,
          theirSharedPrivate,
          today,
          reader
        );
        // Weeks follow whichever run actually wins, so the subheader keeps
        // describing the same streak the header shows.
        const winner =
          privateStats.currentStreak > publicStats.currentStreak
            ? privateStats
            : publicStats;
        stats = {
          currentStreak: winner.currentStreak,
          currentStreakWeeks: winner.currentStreakWeeks,
          longestStreak: Math.max(publicStats.longestStreak, privateStats.longestStreak),
          // Earned in different habits, so they add rather than compete.
          badges: publicStats.badges + privateStats.badges,
        };
      } else if (theirSharedPrivate.length > 0) {
        budget.skipped++;
      }

      return {
        uid,
        displayName: (user.displayName as string | undefined) ?? "Someone",
        username: (user.username as string | undefined) ?? null,
        photoURL: (user.photoURL as string | undefined) ?? null,
        currentStreak: stats.currentStreak,
        currentStreakWeeks: stats.currentStreakWeeks,
        longestStreak: stats.longestStreak,
        badges: stats.badges,
        isSelf,
      };
    })
  );

  // Counts peers actually turned away, not merely a budget that landed on
  // zero: warning whenever the last recompute happened to be the twelfth
  // cried wolf on complete boards, which is how a real partial board stops
  // being noticed.
  if (budget.skipped > 0) {
    console.warn(
      `leaderboard for ${viewerUid}: hit the recompute cap, ${budget.skipped} ${
        budget.skipped === 1 ? "entry" : "entries"
      } served stale`
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
