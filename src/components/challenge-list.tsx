"use client";

import { useState } from "react";
import Link from "next/link";
import { useActivity } from "@/components/activity-provider";
import { progressSummary } from "@/lib/progress";
import { challengeState } from "@/lib/progress";
import { formatYmd, todayYmd } from "@/lib/dates";
import { splitActiveChallenges } from "@/lib/cycles";
import { cn } from "@/lib/utils";
import type { Challenge } from "@/lib/types";
import { CheckinDialog } from "@/components/checkin-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ChallengeList({ uid }: { uid: string }) {
  // The shell already holds this exact query and these exact check-in
  // listeners for the sidebar (see ActivityProvider), so opening a private
  // copy here was reading everything twice on this page.
  const {
    challenges,
    checkinsByChallenge,
    joinedDateByChallenge,
    error: loadError,
    timezone,
  } = useActivity();

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Couldn&apos;t load your challenges</CardTitle>
          <CardDescription>
            Check your connection and try refreshing the page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (challenges === null) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1].map((i) => (
          // Shaped like the ChallengeCard below rather than a plain block, so
          // the swap into real content shifts the page as little as the
          // unknown row count allows. A bare rectangle was both a different
          // height and a different silhouette from what replaced it.
          <Card key={i}>
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="mt-2 h-4 w-3/5" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-9 w-28 rounded-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // One card per habit, not per cycle, and nothing that has already ended
  // under "active" — see lib/cycles.ts for why `status` can't answer either.
  const { live, awaitingResults } = splitActiveChallenges(
    challenges,
    todayYmd(timezone)
  );

  if (live.length === 0 && awaitingResults.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No active challenges yet</CardTitle>
          <CardDescription>
            Start one to hold yourself to it.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {live.length > 0 && (
        <div className="flex flex-col gap-3">
          {live.map((challenge) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              uid={uid}
              timezone={timezone}
              checkinYmds={ymdsFor(checkinsByChallenge, challenge.id)}
              joinedDate={joinedDateByChallenge[challenge.id]}
            />
          ))}
        </div>
      )}
      {/* Kept visible rather than hidden until the nightly job runs: these
          settle real money, and a habit that disappeared for a day and came
          back owing $20 would be the worse surprise. */}
      {awaitingResults.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="type-overline text-xs text-muted-foreground">
            Finishing up
          </h2>
          {awaitingResults.map((challenge) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              uid={uid}
              timezone={timezone}
              checkinYmds={ymdsFor(checkinsByChallenge, challenge.id)}
              joinedDate={joinedDateByChallenge[challenge.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** This habit's dates out of the shared map, or undefined if it hasn't landed. */
function ymdsFor(
  byChallenge: Record<string, { localDate: string }[]>,
  challengeId: string
): string[] | undefined {
  return byChallenge[challengeId]?.map((c) => c.localDate);
}

function ChallengeCard({
  challenge,
  uid,
  timezone,
  checkinYmds,
  joinedDate,
}: {
  challenge: Challenge;
  uid: string;
  timezone: string;
  /** Undefined until this habit's check-ins have arrived. */
  checkinYmds?: string[];
  joinedDate?: string;
}) {
  // The bar animates only once there is something real to animate to. Data now
  // arrives for every card at once rather than card by card, so this no longer
  // guards a staggered ripple — but it still stops a bar sliding up from zero
  // on the frame the data lands.
  const checkinsLoaded = checkinYmds !== undefined;
  const [error, setError] = useState<string | null>(null);

  const today = todayYmd(timezone);
  const state = challengeState(challenge, today);
  const summary = progressSummary(challenge, checkinYmds ?? [], timezone, joinedDate);
  const percent =
    summary.total > 0 ? Math.min(100, (summary.completed / summary.total) * 100) : 0;

  return (
    // "Stretched link" pattern: the title's Link is expanded via its ::after
    // pseudo-element (relative container + after:absolute after:inset-0) to
    // cover the whole card, so tapping anywhere navigates — not just the
    // narrow title text. CheckinDialog's trigger sits at a higher z-index
    // so it keeps intercepting its own taps instead of falling through to
    // the card-covering link underneath it.
    <Card className="relative">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle>
            <Link
              href={`/challenges/${challenge.id}`}
              className="static after:absolute after:inset-0 after:content-[''] hover:underline"
            >
              {challenge.name}
            </Link>
          </CardTitle>
          <Badge variant={challenge.mode === "group" ? "outline" : "ink"}>
            {challenge.mode === "group" ? "Group" : "Solo"}
          </Badge>
        </div>
        <CardDescription>
          {state === "upcoming" && `Starts ${formatYmd(challenge.startDate)}`}
          {state === "active" &&
            `${summary.completed}/${summary.total} check-ins · ${summary.daysRemaining} day${summary.daysRemaining === 1 ? "" : "s"} left`}
          {state === "ended" && "Ended — awaiting results"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-2 overflow-hidden rounded-full bg-secondary">
          {/* The transition is added only once the data is in. A CSS
              transition needs the property set in the *before*-change style
              to fire, so introducing it in the same commit as the new width
              lands the bar at its real value silently — and every later
              check-in still animates, which is the one time the movement
              means something. */}
          <div
            className={cn(
              "h-full rounded-full bg-foreground",
              checkinsLoaded && "transition-all"
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
        {summary.canCheckInToday && (
          <div className="relative z-10 w-fit">
            <CheckinDialog
              challenge={challenge}
              uid={uid}
              today={today}
              timezone={timezone}
              onError={setError}
            />
          </div>
        )}
        {summary.checkedInToday && (
          <p className="text-sm text-muted-foreground">Checked in today ✓</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
