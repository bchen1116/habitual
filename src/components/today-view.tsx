"use client";

import { useState } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { useActiveChallengeCheckins } from "@/hooks/use-active-challenge-checkins";
import { useMaxChainStreak } from "@/hooks/use-chain-streak";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { todayYmd } from "@/lib/dates";
import { challengeState, progressSummary } from "@/lib/progress";
import { weekStripDays, weekStripPercent } from "@/lib/streak";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { GroupCard } from "@/components/group-card";
import { HabitRow } from "@/components/habit-row";
import { InstallBanner } from "@/components/install-banner";
import { LedgerSummary } from "@/components/ledger-summary";
import { PushProvider } from "@/components/push-provider";
import { StatTile } from "@/components/stat-tile";
import { StreakHero } from "@/components/streak-hero";
import { WeekStrip } from "@/components/week-strip";

function greeting(hour: number): string {
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

export function TodayView({
  uid,
  displayName,
  photoURL,
}: {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
}) {
  const timezone = useUserTimezone(uid);
  const { challenges, checkinsByChallenge, loading } = useActiveChallengeCheckins(uid);
  const [error, setError] = useState<string | null>(null);

  const today = todayYmd(timezone);
  const hour = Number(formatInTimeZone(new Date(), timezone, "H"));
  const firstName = (displayName ?? "").trim().split(/\s+/)[0] || "there";
  const dateLabel = formatInTimeZone(new Date(), timezone, "EEEE '·' MMM d");

  const activeChallenges = challenges ?? [];
  const checkinYmdsByChallenge = Object.fromEntries(
    Object.entries(checkinsByChallenge).map(([id, records]) => [
      id,
      records.map((r) => r.localDate),
    ])
  );
  const heroStreak = useMaxChainStreak(activeChallenges, uid, checkinYmdsByChallenge, today);

  const activityYmds = new Set(Object.values(checkinYmdsByChallenge).flat());
  const days = weekStripDays(activityYmds, today);
  const percent = weekStripPercent(days, today);

  const doneCount = activeChallenges.filter(
    (c) => progressSummary(c, checkinYmdsByChallenge[c.id] ?? [], timezone).checkedInToday
  ).length;
  const actionableCount = activeChallenges.filter(
    (c) => challengeState(c, today) === "active"
  ).length;

  const totalCheckIns = Object.values(checkinsByChallenge).reduce(
    (sum, records) => sum + records.length,
    0
  );
  const mostActiveGroup = activeChallenges.find((c) => c.mode === "group");

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-5 lg:gap-6 lg:p-9">
      <header className="flex items-center justify-between">
        <div>
          <p className="type-overline text-xs text-muted-foreground">{dateLabel}</p>
          <h1 className="type-display text-3xl lg:text-[42px]">
            {greeting(hour)}, {firstName}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button asChild size="sm" variant="secondary" className="hidden lg:inline-flex">
            <Link href="/challenges/new">+ New habit</Link>
          </Button>
          <Link href="/settings">
            <Avatar src={photoURL} name={displayName} size="md" />
          </Link>
        </div>
      </header>

      <PushProvider uid={uid} />
      <InstallBanner />
      <LedgerSummary uid={uid} />

      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        <div className="flex flex-1 flex-col gap-[18px] lg:gap-[22px]">
          <StreakHero streak={heroStreak} />

          <div className="flex items-center justify-between">
            <h2 className="type-display text-xl lg:text-2xl">Today</h2>
            {activeChallenges.length > 0 && (
              <span className="type-overline text-xs text-muted-foreground">
                {doneCount}/{actionableCount} done
              </span>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-col gap-2.5 lg:gap-3">
            {loading &&
              [0, 1].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
              ))}
            {!loading && activeChallenges.length === 0 && (
              <div className="rounded-2xl bg-card px-4 py-6 text-center">
                <p className="font-bold">No habits yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start one to hold yourself to it.
                </p>
              </div>
            )}
            {activeChallenges.map((challenge) => (
              <HabitRow
                key={challenge.id}
                challenge={challenge}
                uid={uid}
                timezone={timezone}
                checkins={checkinsByChallenge[challenge.id] ?? []}
                onError={setError}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-[22px] lg:w-[384px] lg:shrink-0">
          <WeekStrip days={days} percent={percent} />
          <div className="hidden grid-cols-2 gap-3.5 lg:grid">
            <StatTile value={totalCheckIns} label="Total check-ins" />
            <StatTile value={activeChallenges.length} label="Active habits" />
          </div>
          {mostActiveGroup && (
            <div className="hidden lg:block">
              <GroupCard challenge={mostActiveGroup} timezone={timezone} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
