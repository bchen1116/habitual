"use client";

import { formatYmd } from "@/lib/dates";
import {
  averageRating,
  rankHabitsByRating,
  ratedSessions,
  ratingTrend,
  weeklyRatingAverages,
} from "@/lib/rating-stats";
import { MAX_RATING } from "@/lib/reflections";
import type { HabitReflections } from "@/hooks/use-reflection-history";
import { StatTile } from "@/components/stat-tile";

/** Most recent weeks charted. Older ones are summarised, never silently dropped. */
const MAX_WEEKS_CHARTED = 26;

/**
 * Session ratings across every habit, over the long run.
 *
 * The per-habit card answers "how is this one going"; this answers the
 * question a streak has never been able to — whether the sessions themselves
 * are getting better, and which habits are actually worth the time as opposed
 * to merely being kept up.
 */
export function LifetimeRatings({
  habits,
  error,
}: {
  habits: HabitReflections[] | null;
  error: boolean;
}) {
  if (error) {
    return (
      <Section>
        <p className="mt-4 text-sm text-muted-foreground">
          Couldn&apos;t load your session ratings.
        </p>
      </Section>
    );
  }

  if (habits === null) {
    return (
      <Section>
        <div className="mt-4 h-40 animate-pulse rounded-2xl bg-muted" />
      </Section>
    );
  }

  const perHabit = habits.map((habit) => ({
    challengeId: habit.challengeId,
    name: habit.name,
    sessions: ratedSessions(habit.reflections),
  }));
  const all = perHabit
    .flatMap((h) => h.sessions)
    .sort((a, b) => a.localDate.localeCompare(b.localDate));

  if (all.length === 0) {
    return (
      <Section>
        <div className="mt-4 rounded-2xl bg-card px-4 py-6 text-center">
          <p className="font-bold">No rated sessions yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Rate a session when you check in and it&apos;ll start building a
            picture here — not just whether you showed up, but how it went.
          </p>
        </div>
      </Section>
    );
  }

  const average = averageRating(all);
  const trend = ratingTrend(all, 14);
  const weeks = weeklyRatingAverages(all);
  const charted = weeks.slice(-MAX_WEEKS_CHARTED);
  const ranked = rankHabitsByRating(perHabit);

  return (
    <Section>
      <div className="mt-4 grid grid-cols-2 gap-3.5">
        <StatTile value={`${average}`} label={`Avg. rating / ${MAX_RATING}`} />
        <StatTile value={all.length} label="Sessions rated" />
      </div>

      {trend && (
        <p className="mt-3 text-sm text-muted-foreground">
          {trend.delta === 0
            ? `Steady — recent sessions average ${trend.recent}, same as before.`
            : `Recent sessions average ${trend.recent} — ${
                trend.delta > 0 ? "up" : "down"
              } ${Math.abs(trend.delta)} on the ${trend.earlier} before them.`}
        </p>
      )}

      {charted.length > 1 && (
        <div className="mt-5 rounded-2xl bg-card p-4">
          <p className="type-overline text-xs text-muted-foreground">
            Average by week
            {weeks.length > charted.length && ` · last ${charted.length} weeks`}
          </p>
          <WeeklyBars buckets={charted} />
        </div>
      )}

      {ranked.length > 0 && (
        <div className="mt-3.5 rounded-2xl bg-card p-4">
          <p className="type-overline text-xs text-muted-foreground">
            Habits by average rating
          </p>
          {/* Habits with fewer than a few ratings are left out by
              rankHabitsByRating rather than ranked off one lucky 10 — said
              plainly here so a missing habit doesn't look like a bug. */}
          <ol className="mt-3 flex flex-col gap-2.5">
            {ranked.map((habit, i) => (
              <li key={habit.challengeId} className="flex items-center gap-3">
                <span className="type-display w-4 shrink-0 text-sm text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold">
                  {habit.name}
                </span>
                <span className="shrink-0 text-sm">
                  <span className="type-display text-lg">{habit.average}</span>
                  <span className="type-overline ml-1 text-[11px] text-muted-foreground">
                    {habit.count} rated
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {ranked.length < perHabit.filter((h) => h.sessions.length > 0).length && (
            <p className="mt-3 text-xs text-muted-foreground">
              Habits with fewer than 3 rated sessions aren&apos;t ranked yet.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h2 className="type-display text-xl">Session ratings</h2>
      {children}
    </div>
  );
}

function WeeklyBars({
  buckets,
}: {
  buckets: { start: string; average: number; count: number }[];
}) {
  return (
    <>
      <div aria-hidden className="mt-3 flex h-24 items-end gap-1">
        {buckets.map((bucket) => (
          <div
            key={bucket.start}
            title={`Week of ${formatYmd(bucket.start)}: ${bucket.average}/${MAX_RATING} across ${bucket.count} session${bucket.count === 1 ? "" : "s"}`}
            className="flex h-full min-w-0 flex-1 items-end rounded-[3px] bg-secondary"
          >
            <div
              className="w-full rounded-[3px] bg-foreground"
              style={{ height: `${(bucket.average / MAX_RATING) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between">
        <span className="type-overline text-[10px] text-muted-foreground">
          {formatYmd(buckets[0].start)}
        </span>
        <span className="type-overline text-[10px] text-muted-foreground">
          {formatYmd(buckets[buckets.length - 1].start)}
        </span>
      </div>
      <ul className="sr-only">
        {buckets.map((bucket) => (
          <li key={bucket.start}>
            Week of {formatYmd(bucket.start)}: {bucket.average} out of {MAX_RATING}
            , across {bucket.count} session{bucket.count === 1 ? "" : "s"}
          </li>
        ))}
      </ul>
    </>
  );
}
