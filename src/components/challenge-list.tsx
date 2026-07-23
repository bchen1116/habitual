"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { activeChallengesQuery } from "@/lib/challenges";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { progressSummary } from "@/lib/progress";
import { challengeState } from "@/lib/progress";
import { formatYmd, todayYmd } from "@/lib/dates";
import type { Challenge } from "@/lib/types";
import { CheckinDialog } from "@/components/checkin-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ChallengeList({ uid }: { uid: string }) {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      activeChallengesQuery(getClientDb(), uid),
      (snap) => {
        const items = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Challenge
        );
        items.sort((a, b) => a.startDate.localeCompare(b.startDate));
        setChallenges(items);
        setLoadError(false);
      },
      (err) => {
        // Don't disguise errors (e.g. a missing Firestore index) as an
        // empty list — that reads as "no challenges" and misleads.
        console.error("challenges query failed:", err);
        setLoadError(true);
      }
    );
    return unsubscribe;
  }, [uid]);

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
          <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (challenges.length === 0) {
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
    <div className="flex flex-col gap-3">
      {challenges.map((challenge) => (
        <ChallengeCard key={challenge.id} challenge={challenge} uid={uid} />
      ))}
    </div>
  );
}

function ChallengeCard({ challenge, uid }: { challenge: Challenge; uid: string }) {
  const timezone = useUserTimezone(uid);
  const [checkinYmds, setCheckinYmds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(getClientDb(), "challenges", challenge.id, "checkins"),
      (snap) => {
        setCheckinYmds(
          snap.docs
            .map((d) => d.data())
            .filter((c) => c.uid === uid)
            .map((c) => c.localDate as string)
        );
      }
    );
    return unsubscribe;
  }, [challenge.id, uid]);

  const today = todayYmd(timezone);
  const state = challengeState(challenge, today);
  const summary = progressSummary(challenge, checkinYmds, timezone);
  const percent =
    summary.total > 0 ? Math.min(100, (summary.completed / summary.total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/challenges/${challenge.id}`} className="hover:underline">
            <CardTitle>{challenge.name}</CardTitle>
          </Link>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
            {challenge.mode === "group" ? "Group" : "Solo"}
          </span>
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
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        {summary.canCheckInToday && (
          <div>
            <CheckinDialog
              challenge={challenge}
              uid={uid}
              today={today}
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
