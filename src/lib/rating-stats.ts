import { addDaysYmd, ymdToDate } from "@/lib/dates";
import type { MissReason, Reflection } from "@/lib/types";

/**
 * Aggregation over self-reported session ratings (1–10). Pure and
 * server-safe: no Firestore, no "use client", so the same functions serve the
 * per-habit card and the lifetime Progress view, and stay unit-testable.
 *
 * Everything here treats an unrated day as absent rather than as a zero. A
 * rating is optional at check-in by design (docs on CheckinDialog), so
 * counting skipped ratings as 0 would punish exactly the people who used the
 * feature honestly-but-occasionally and drag every average toward nothing.
 */

/** One rated session, flattened out of a Reflection. */
export interface RatedSession {
  localDate: string; // yyyymmdd
  rating: number;
}

export function ratedSessions(reflections: readonly Reflection[]): RatedSession[] {
  return reflections
    .filter(
      (r): r is Reflection & { rating: number } =>
        typeof r.rating === "number" && Number.isFinite(r.rating)
    )
    .map((r) => ({ localDate: r.localDate, rating: r.rating }))
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
}

/** Mean rating, or null when nothing has been rated. Rounded to one decimal. */
export function averageRating(sessions: readonly RatedSession[]): number | null {
  if (sessions.length === 0) return null;
  const sum = sessions.reduce((total, s) => total + s.rating, 0);
  return Math.round((sum / sessions.length) * 10) / 10;
}

export interface RatingTrend {
  recent: number;
  earlier: number;
  /** recent − earlier, one decimal. Positive means sessions are improving. */
  delta: number;
}

/**
 * Recent sessions against everything before them. Null until there are enough
 * on both sides to be worth stating — a "trend" drawn from one session either
 * side is noise dressed up as insight.
 */
export function ratingTrend(
  sessions: readonly RatedSession[],
  windowSize = 7
): RatingTrend | null {
  const minPerSide = 3;
  if (sessions.length < minPerSide * 2) return null;
  const splitAt = Math.max(minPerSide, sessions.length - windowSize);
  const earlier = averageRating(sessions.slice(0, splitAt));
  const recent = averageRating(sessions.slice(splitAt));
  if (earlier === null || recent === null) return null;
  return {
    recent,
    earlier,
    delta: Math.round((recent - earlier) * 10) / 10,
  };
}

export interface RatingBucket {
  /** yyyymmdd of the bucket's first day. */
  start: string;
  average: number;
  count: number;
}

/**
 * Average by week, for "how has this trended over time". Weeks are anchored to
 * the earliest rated session rather than to Sunday/Monday, so the first bucket
 * is always full-width and the series doesn't open with a stub week that dips
 * for no reason other than having fewer days in it.
 *
 * Weeks with no ratings are omitted, not zero-filled — see the module note.
 */
export function weeklyRatingAverages(sessions: readonly RatedSession[]): RatingBucket[] {
  if (sessions.length === 0) return [];
  const anchor = sessions[0].localDate;
  const anchorMs = ymdToDate(anchor).getTime();

  const buckets = new Map<number, RatedSession[]>();
  for (const session of sessions) {
    const days = Math.round(
      (ymdToDate(session.localDate).getTime() - anchorMs) / 86_400_000
    );
    const index = Math.floor(days / 7);
    const existing = buckets.get(index);
    if (existing) existing.push(session);
    else buckets.set(index, [session]);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, group]) => ({
      start: addDaysYmd(anchor, index * 7),
      average: averageRating(group)!,
      count: group.length,
    }));
}

export interface RatedHabit {
  challengeId: string;
  name: string;
  average: number;
  count: number;
}

/**
 * Habits ranked best-rated first. Habits with too few ratings to mean anything
 * are dropped rather than ranked — one glowing 10 shouldn't outrank a habit
 * with thirty honest 8s.
 */
export function rankHabitsByRating(
  habits: readonly { challengeId: string; name: string; sessions: readonly RatedSession[] }[],
  minSessions = 3
): RatedHabit[] {
  return habits
    .filter((h) => h.sessions.length >= minSessions)
    .map((h) => ({
      challengeId: h.challengeId,
      name: h.name,
      average: averageRating(h.sessions)!,
      count: h.sessions.length,
    }))
    .sort((a, b) => b.average - a.average || b.count - a.count || a.name.localeCompare(b.name));
}

export interface MissReasonCount {
  reason: MissReason;
  count: number;
}

/** Recorded miss reasons, commonest first. */
export function missReasonCounts(
  reflections: readonly Reflection[]
): MissReasonCount[] {
  const counts = new Map<MissReason, number>();
  for (const reflection of reflections) {
    if (!reflection.missReason) continue;
    counts.set(reflection.missReason, (counts.get(reflection.missReason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
