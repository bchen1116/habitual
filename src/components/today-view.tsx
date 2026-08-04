"use client";

import { useState } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { useActivity } from "@/components/activity-provider";
import { useMaxChainStreak } from "@/hooks/use-chain-streak";
import { liveChallenges } from "@/lib/cycles";
import { todayYmd } from "@/lib/dates";
import { challengeState, habitWeek, progressSummary } from "@/lib/progress";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DayCountdown } from "@/components/day-countdown";
import { GroupCard } from "@/components/group-card";
import { HabitRow } from "@/components/habit-row";
import { InstallBanner } from "@/components/install-banner";
import { PushProvider } from "@/components/push-provider";
import { StatTile } from "@/components/stat-tile";
import { StreakHero } from "@/components/streak-hero";

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
  const {
    challenges,
    checkinsByChallenge,
    joinedDateByChallenge,
    loading,
    error: loadError,
    timezone,
  } = useActivity();
  const [error, setError] = useState<string | null>(null);

  const today = todayYmd(timezone);
  const hour = Number(formatInTimeZone(new Date(), timezone, "H"));
  const firstName = (displayName ?? "").trim().split(/\s+/)[0] || "there";
  const dateLabel = formatInTimeZone(new Date(), timezone, "EEEE '·' MMM d");

  // One entry per habit, and nothing that has already ended: every cycle of a
  // repeating habit is its own challenge doc, and `status` stays "active"
  // until the nightly job grades it (see lib/cycles.ts).
  const activeChallenges = liveChallenges(challenges ?? [], today);
  const checkinYmdsByChallenge = Object.fromEntries(
    Object.entries(checkinsByChallenge).map(([id, records]) => [
      id,
      records.map((r) => r.localDate),
    ])
  );
  const heroStreak = useMaxChainStreak(
    activeChallenges,
    uid,
    checkinYmdsByChallenge,
    today,
    joinedDateByChallenge
  );

  const doneCount = activeChallenges.filter(
    (c) => progressSummary(c, checkinYmdsByChallenge[c.id] ?? [], timezone).checkedInToday
  ).length;
  const actionableCount = activeChallenges.filter(
    (c) => challengeState(c, today) === "active"
  ).length;

  // What the countdown is counting down *for*. Not simply "can still check in
  // today": a 3×/week habit that has already had its three runs can still
  // accept a fourth, and putting a clock on that would be inventing a
  // deadline the habit doesn't have. A daily habit has no such out — its
  // target is every day, so not-yet-today is always outstanding.
  const outstandingToday = activeChallenges.filter((c) => {
    const ymds = checkinYmdsByChallenge[c.id] ?? [];
    const joinedDate = joinedDateByChallenge[c.id];
    if (!progressSummary(c, ymds, timezone, joinedDate).canCheckInToday) return false;
    const week = habitWeek(c, ymds, today, joinedDate);
    if (week?.allowsExtras && week.count >= week.target) return false;
    return true;
  }).length;

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
          <Button asChild size="sm" variant="outline" className="hidden lg:inline-flex">
            <Link href="/challenges/new">+ New habit</Link>
          </Button>
          <Link href="/settings">
            <Avatar src={photoURL} name={displayName} size="md" />
          </Link>
        </div>
      </header>

      <PushProvider uid={uid} />
      <InstallBanner />

      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        <div className="flex flex-1 flex-col gap-[18px] lg:gap-[22px]">
          {/* `loading` counts as pending too: with no habits read yet the
              hero's honest answer is 0, and 0 → 1 → 37 is the same wrong-then-
              corrected number twice over. */}
          <StreakHero
            streak={heroStreak.streak}
            weeks={heroStreak.weeks}
            pending={loading || heroStreak.pending}
          />

          {/* Between the hero and the list: it's about the list, but it's the
              thing you'd want to see before deciding whether to scroll. Hides
              itself outside the last six hours, and whenever nothing is
              outstanding — see DayCountdown. */}
          <DayCountdown timezone={timezone} outstanding={outstandingToday} />

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
            {!loading && loadError && (
              <div className="rounded-2xl bg-card px-4 py-6 text-center">
                <p className="font-bold">Couldn&apos;t load your habits</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Check your connection and try refreshing the page.
                </p>
              </div>
            )}
            {!loading && !loadError && activeChallenges.length === 0 && (
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
                joinedDate={joinedDateByChallenge[challenge.id]}
                onError={setError}
              />
            ))}
          </div>
        </div>

        {/* Each habit carries its own week now (HabitRow), so this column no
            longer opens with a single Mon–Sun strip pooling all of them — two
            habits that started on different days share no week, and one bar
            averaging them described neither. */}
        <div className="flex flex-col gap-[22px] lg:w-[384px] lg:shrink-0">
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
