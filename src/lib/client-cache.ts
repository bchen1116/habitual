"use client";

/**
 * A small in-memory cache for work that is expensive to redo and cheap to keep.
 *
 * The problem it solves is navigation, not first load. Streaks and the
 * leaderboard are the two things in this app that cost real round trips —
 * chain walks read every ancestor cycle of a habit, and /api/leaderboard
 * recomputes for every peer — and under the App Router a client-side
 * navigation tears every component down while leaving the JS context alive.
 * So Today → Habits → Today paid for all of it three times, for data that
 * hadn't changed between the first visit and the third.
 *
 * Module scope is deliberately the whole lifetime: it survives navigation and
 * dies on a hard reload, which is exactly the boundary being asked for. There
 * is no TTL, because a clock is a poor stand-in for knowing whether something
 * changed — every key here instead encodes the inputs it was computed from
 * (see `chainStreakKey`), so a hit is only ever a hit when nothing that fed
 * the value has moved. Anything a key can't express is invalidated explicitly:
 * checkIn() calls `invalidateAfterCheckin`, and signing out clears the lot.
 *
 * Not persisted to sessionStorage on purpose. Surviving a reload sounds like a
 * free upgrade, but a reload is also the one action someone takes when the app
 * looks wrong — and a cache that survives it turns "refresh the page" into
 * advice that no longer works.
 */

/** Bounded so a long session with many habits can't grow this without limit. */
const MAX_ENTRIES = 200;

const store = new Map<string, unknown>();

function set(key: string, value: unknown): void {
  // Insertion-ordered, so the oldest key is the first one out. Crude next to a
  // true LRU, and enough: the working set is one user's habits.
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(key, value);
}

/** The cached value for `key`, or undefined. Synchronous — safe in a `useState` initializer. */
export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function cacheSet<T>(key: string, value: T): void {
  set(key, value);
}

/**
 * Deduplicates in-flight work as well as completed work: the *promise* is
 * cached, not just its result, so two components mounting at once share one
 * request instead of racing to make the same one twice. A rejection is evicted
 * so a failure is retried rather than cached forever.
 */
export function cachedPromise<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = store.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = load().catch((err) => {
    store.delete(key);
    throw err;
  });
  set(key, promise);
  return promise;
}

export function invalidatePrefix(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function clearClientCache(): void {
  store.clear();
}

/**
 * Everything a check-in can change. Called by checkIn() itself rather than
 * left to callers, so a new check-in path can't forget and start serving a
 * streak that is quietly one short.
 *
 * Deliberately broad. A check-in moves the streak on that habit, the best
 * streak across all habits, and the rank of the person on every board they
 * appear on — and the cost of being broad is one recomputation of things that
 * were about to be recomputed anyway.
 */
export function invalidateAfterCheckin(challengeId: string): void {
  invalidatePrefix("streak:");
  invalidatePrefix("leaderboard:");
  invalidatePrefix(`checkins:${challengeId}:`);
}

/**
 * Everything derived from a habit's own terms or shape: repeating one (a new
 * cycle joins the chain) or editing one (skip days feed the streak floor).
 *
 * Broader than the check-in case because the *structure* moved, not just a
 * day's data — and the read cache holds cycle documents whose contents an
 * edit can change. The keys used by the chain reader in lib/chain-streak.ts
 * are listed here so a rename can't silently orphan one; the check-in path
 * once cleared "cycles:" while the reader wrote "cycle:", which is a cache
 * that quietly never expires.
 */
export function invalidateHabitShape(): void {
  invalidatePrefix("streak:");
  invalidatePrefix("leaderboard:");
  invalidatePrefix("cycle:");
  invalidatePrefix("checkins:");
  invalidatePrefix("joined:");
}

/**
 * A cache key that encodes every input a chain streak is computed from, so a
 * hit can only happen when recomputing would produce the same answer.
 *
 * The one input not encoded is the ancestor cycles' own data, which the walk
 * reads but the caller doesn't hold. That is safe for the reason the whole
 * chain design rests on: an ancestor cycle has ended, and an ended cycle's
 * dates, membership and check-ins are all frozen. Nothing can change them
 * behind this key.
 */
export function chainStreakKey(
  kind: "current" | "longest",
  uid: string,
  today: string,
  chainKey: string,
  checkinsKey: string
): string {
  return `streak:${kind}:${uid}:${today}:${chainKey}:${checkinsKey}`;
}
