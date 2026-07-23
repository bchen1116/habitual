"use client";

import { useActiveChallengeCheckins } from "@/hooks/use-active-challenge-checkins";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { todayYmd } from "@/lib/dates";
import { maxLongestStreak } from "@/lib/streak";
import { StatTile } from "@/components/stat-tile";

export function StatsView({ uid }: { uid: string }) {
  const timezone = useUserTimezone(uid);
  const { challenges, checkinsByChallenge, loading } = useActiveChallengeCheckins(uid);
  const today = todayYmd(timezone);

  const activeChallenges = challenges ?? [];
  const checkinYmdsByChallenge = Object.fromEntries(
    Object.entries(checkinsByChallenge).map(([id, records]) => [
      id,
      records.map((r) => r.localDate),
    ])
  );
  const totalCheckIns = Object.values(checkinsByChallenge).reduce(
    (sum, records) => sum + records.length,
    0
  );
  const longestStreak = maxLongestStreak(activeChallenges, checkinYmdsByChallenge, today);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-5 lg:p-9">
      <h1 className="type-display text-3xl">Progress</h1>

      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <div className="grid grid-cols-2 gap-3.5">
          <StatTile value={totalCheckIns} label="Total check-ins" />
          <StatTile value={activeChallenges.length} label="Active habits" />
          <StatTile value={longestStreak} label="Longest streak" />
        </div>
      )}
    </div>
  );
}
