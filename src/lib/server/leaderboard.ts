import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  chainLongestStreakWith,
  walkChainWith,
  type ChainReader,
} from "@/lib/chain-core";
import { streakRun } from "@/lib/streak";
import { awayDaysFor } from "@/lib/away";
import { badgesEarnedIn } from "@/lib/badges";
import { yyyymmddUTC } from "@/lib/server/challenge-admin";
import type {
  AwayRange,
  Challenge,
  LeaderboardVisibility,
} from "@/lib/types";

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
  /** Spare skips earned by perfect weeks — shown beside the streak. */
  badges: number;
  isSelf: boolean;
}

export interface StreakPair {
  currentStreak: number;
  /** Calendar span of the current streak, in whole weeks. */
  currentStreakWeeks: number;
  longestStreak: number;
  /**
   * Spare skips earned by perfect weeks, across the habits in scope.
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
    async getAwayRanges(uid) {
      const snap = await db.collection("users").doc(uid).get();
      return (snap.data()?.awayRanges as AwayRange[] | undefined) ?? [];
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
    // Keyed on the user alone, not on a cycle: a chain walk asks per ancestor
    // and a shared board asks per peer, so without the memo this would be one
    // user-doc read per cycle per member.
    getAwayRanges: (uid) => memo(`a:${uid}`, () => inner.getAwayRanges(uid)),
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
      const [ymds, joinedDate, awayRanges] = await Promise.all([
        reader.getCheckinYmds(challenge.id, uid),
        // Their own start, so a habit they joined mid-week ranks the same way
        // it reads on their own dashboard.
        reader.getJoinedDate(challenge.id, uid),
        reader.getAwayRanges(uid),
      ]);
      // Same reason as joinedDate: the board has to rank people by the same
      // streak their own hero shows them, and a run that survives a declared
      // holiday on the dashboard has to survive it here too.
      const away = awayDaysFor(challenge, awayRanges, joinedDate);
      const run = streakRun(challenge, ymds, today, joinedDate, away);
      // Chain-aware, so this matches the number the user's own hero shows.
      const carry =
        run.reachesFloor && !challenge.streakResetAt && challenge.repeatedFromId
          ? await walkChainWith(reader, challenge, uid)
          : { streak: 0, spanDays: 0 };
      return {
        chained: run.streak + carry.streak,
        weeks: Math.floor((run.spanDays + carry.spanDays) / 7),
        longest: await chainLongestStreakWith(reader, challenge, uid, today),
        badges: badgesEarnedIn(challenge, ymds, today, joinedDate, away),
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
  // Should be rare now that precomputeStreakStats fills this ahead of anyone
  // asking (see vercel.json). It still has to work: a user created since the
  // last run has no entry, and a scheduled run that failed must degrade to the
  // old on-demand behaviour rather than to a blank board.
  return computeAndStorePublicStats(db, uid, today, reader);
}

export interface PrecomputeResult {
  /** Users whose stats were recomputed and written. */
  refreshed: number;
  /** Users already current for today — a re-run within the same day. */
  upToDate: number;
  /** Users whose recompute threw; the rest of the run continues. */
  failed: number;
}

/**
 * Fill `userStreakStats` for everyone, ahead of anyone asking.
 *
 * The board is the most expensive thing in the app — a chain walk per habit
 * per peer — and until now the first person to open it each day paid to
 * compute for everyone they know, with MAX_RECOMPUTES_PER_REQUEST capping how
 * much of that one request would attempt. Past the cap the board is served
 * from yesterday's figures and converges only over later visits, so the cost
 * did not merely fall on one person: it made the answer worse for them.
 *
 * Running it on a schedule turns the request path into plain document reads,
 * and it fits the existing cache exactly rather than working around it. The
 * key is a UTC date (see getPublicStats), so every user's entry goes stale at
 * the same instant — midnight UTC — and a single run just after that covers
 * the whole day for everybody. There is no per-timezone staleness to reason
 * about, because the leaderboard has never used per-user local days.
 *
 * Deliberately no recompute budget here: the budget exists to stop one
 * *request* doing unbounded work while somebody waits. Nobody is waiting on
 * this, and doing the whole set is the entire point.
 *
 * One reader for the run, not one per user, because peers share habits — a
 * group challenge document is then read once for all its members rather than
 * once each.
 */
export async function precomputeStreakStats(
  now: Date = new Date()
): Promise<PrecomputeResult> {
  const db = getAdminDb();
  const today = yyyymmddUTC(now);
  const reader = memoizedChainReader(db);
  // Ids only — nothing on the user document itself is needed.
  const users = await db.collection("users").select().get();

  const result: PrecomputeResult = { refreshed: 0, upToDate: 0, failed: 0 };
  // Sequential on purpose. This runs unattended with nobody waiting, and a
  // fan-out over every user at once is how a scheduled job turns into a
  // thundering herd against Firestore.
  for (const doc of users.docs) {
    try {
      const written = await refreshPublicStats(db, doc.id, today, reader);
      if (written) result.refreshed++;
      else result.upToDate++;
    } catch (err) {
      // One user's bad data must not cost everyone else their refresh.
      console.error(`precompute failed for ${doc.id}:`, err);
      result.failed++;
    }
  }
  return result;
}

/**
 * Recompute and store one user's public stats. Returns false if they were
 * already current for `today`, so a re-run in the same day is nearly free.
 */
async function refreshPublicStats(
  db: Firestore,
  uid: string,
  today: string,
  reader: ChainReader
): Promise<boolean> {
  const ref = db.collection("userStreakStats").doc(uid);
  const snap = await ref.get();
  if (snap.data()?.computedFor === today) return false;
  await computeAndStorePublicStats(db, uid, today, reader);
  return true;
}

/**
 * The single place a user's public stats are computed and written.
 *
 * Both callers need exactly this — the scheduled precompute and the
 * request-time miss in getPublicStats — and two copies of "which habits
 * count, and what gets stored under which key" is the kind of duplication
 * that stays correct right up until one side is edited. The visibility filter
 * in particular is a privacy rule, not an implementation detail: a private
 * habit must not reach the cache that other people's boards read from.
 */
async function computeAndStorePublicStats(
  db: Firestore,
  uid: string,
  today: string,
  reader: ChainReader
): Promise<StreakPair> {
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
  await db
    .collection("userStreakStats")
    .doc(uid)
    .set(
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
