"use client";

import { formatYmd } from "@/lib/dates";
import {
  averageRating,
  missReasonCounts,
  ratedSessions,
  ratingTrend,
} from "@/lib/rating-stats";
import { MAX_RATING, missReasonLabel } from "@/lib/reflections";
import type { Reflection } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * How this habit's sessions have actually felt, over the course of the habit.
 *
 * The point of the card is the one thing a streak can't tell you: a 30-day
 * streak of sessions you rated 3 is not the same achievement as a 30-day
 * streak of 9s, and until now the app couldn't tell them apart. The trend
 * line matters more than the average — "these are getting better" is the
 * actual evidence that a habit is doing something.
 */
export function SessionRatingsCard({ reflections }: { reflections: Reflection[] }) {
  const sessions = ratedSessions(reflections);
  const average = averageRating(sessions);
  const trend = ratingTrend(sessions);
  const misses = missReasonCounts(reflections);

  // Nothing rated and nothing explained — an empty card here would be pure
  // furniture on a page that already has plenty.
  if (sessions.length === 0 && misses.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>How it&apos;s been going</CardTitle>
        <CardDescription>
          Your own ratings and notes. Private — no one else in this habit can
          see them, and they don&apos;t affect your streak or the leaderboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {average !== null && (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="type-display text-4xl">{average}</span>
              <span className="type-overline text-xs text-muted-foreground">
                / {MAX_RATING} average
              </span>
              <span className="ml-auto type-overline text-xs text-muted-foreground">
                {sessions.length} rated
              </span>
            </div>
            {trend && (
              <p className="mt-1 text-sm text-muted-foreground">
                {trend.delta === 0
                  ? `Holding steady at ${trend.recent} lately.`
                  : `Recent sessions average ${trend.recent} — ${
                      trend.delta > 0 ? "up" : "down"
                    } ${Math.abs(trend.delta)} on the ${trend.earlier} before them.`}
              </p>
            )}
          </div>
        )}

        {sessions.length > 0 && <RatingBars sessions={sessions} />}

        {misses.length > 0 && (
          <div>
            <p className="type-overline mb-2 text-xs text-muted-foreground">
              What got in the way
            </p>
            <div className="flex flex-col gap-1.5">
              {misses.map((miss) => (
                <div key={miss.reason} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{missReasonLabel(miss.reason)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {miss.count}×
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Most bars drawn. A year-long daily habit can rate 364 sessions, and past
 * roughly this many the bars are thinner than the gap between them — the
 * chart stops being readable rather than merely dense. Older sessions still
 * count toward the average and the trend above; only the drawing is capped.
 */
const MAX_SESSIONS_CHARTED = 60;

function RatingBars({
  sessions: all,
}: {
  sessions: { localDate: string; rating: number }[];
}) {
  const sessions = all.slice(-MAX_SESSIONS_CHARTED);
  return (
    <div>
      {all.length > sessions.length && (
        <p className="type-overline mb-2 text-xs text-muted-foreground">
          Last {sessions.length} rated sessions
        </p>
      )}
      {/* The bars are decorative duplication of what the summary above already
          states; the readable version is the list, hidden visually. */}
      {/* Deliberately a much tighter radius than the app's rounded-sm (10px):
          at this bar width that reads as a row of pills, and the fill's
          rounded top corners against the track's make the tops look ragged. */}
      <div aria-hidden className="flex h-20 items-end gap-[3px]">
        {sessions.map((session) => (
          <div
            key={session.localDate}
            title={`${formatYmd(session.localDate)}: ${session.rating}/${MAX_RATING}`}
            className="flex h-full min-w-0 flex-1 items-end rounded-[3px] bg-secondary"
          >
            <div
              className="w-full rounded-[3px] bg-foreground"
              style={{ height: `${(session.rating / MAX_RATING) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between">
        <span className="type-overline text-[10px] text-muted-foreground">
          {formatYmd(sessions[0].localDate)}
        </span>
        {sessions.length > 1 && (
          <span className="type-overline text-[10px] text-muted-foreground">
            {formatYmd(sessions[sessions.length - 1].localDate)}
          </span>
        )}
      </div>
      <ul className="sr-only">
        {sessions.map((session) => (
          <li key={session.localDate}>
            {formatYmd(session.localDate)}: {session.rating} out of {MAX_RATING}
          </li>
        ))}
      </ul>
    </div>
  );
}
