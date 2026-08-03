"use client";

import { useActiveChallengeCheckins } from "@/hooks/use-active-challenge-checkins";
import { useChallengeHistory } from "@/hooks/use-challenge-history";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { splitActiveChallenges } from "@/lib/cycles";
import { todayYmd } from "@/lib/dates";
import { totalRequired } from "@/lib/progress";
import { GroupCard } from "@/components/group-card";
import { PastGroupCard } from "@/components/past-group-card";

export function GroupsView({ uid }: { uid: string }) {
  const timezone = useUserTimezone(uid);
  const {
    challenges,
    checkinsByChallenge,
    joinedDateByChallenge,
    loading,
    error: activeError,
  } = useActiveChallengeCheckins(uid);
  const { entries: history, error: historyError } = useChallengeHistory(uid);

  // A repeating group is one group, not one per cycle, and a group whose end
  // date has passed doesn't belong under "active" just because the nightly
  // job hasn't graded it yet — see lib/cycles.ts.
  const { live, awaitingResults } = splitActiveChallenges(
    (challenges ?? []).filter((c) => c.mode === "group"),
    todayYmd(timezone)
  );

  // Ungraded, so there is no stored completedCount to read — but the
  // check-ins are already loaded, so the figure shown is the real one rather
  // than a placeholder 0%.
  const pendingEntries = awaitingResults.map((challenge) => ({
    challenge,
    outcome: null,
    completedCount: Math.min(
      (checkinsByChallenge[challenge.id] ?? []).length,
      totalRequired(challenge, joinedDateByChallenge[challenge.id])
    ),
    joinedDate: joinedDateByChallenge[challenge.id],
  }));

  const pastGroups = (history ?? [])
    .filter((e) => e.challenge.mode === "group")
    .sort((a, b) => b.challenge.endDate.localeCompare(a.challenge.endDate));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-5 lg:p-9">
      <div>
        <h1 className="type-display text-3xl">Groups</h1>

        {loading && <div className="mt-4 h-32 animate-pulse rounded-2xl bg-muted" />}

        {!loading && activeError && (
          <div className="mt-4 rounded-2xl bg-card px-4 py-6 text-center">
            <p className="font-bold">Couldn&apos;t load your groups</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Check your connection and try refreshing the page.
            </p>
          </div>
        )}

        {!loading && !activeError && live.length === 0 && (
          <div className="mt-4 rounded-2xl bg-card px-4 py-6 text-center">
            <p className="font-bold">No active groups</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Join or start a group challenge to see it here.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          {live.map((c) => (
            <GroupCard key={c.id} challenge={c} timezone={timezone} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="type-display text-xl">Past groups</h2>

        {historyError ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Couldn&apos;t load your past groups.
          </p>
        ) : history === null ? (
          <div className="mt-4 h-24 animate-pulse rounded-2xl bg-muted" />
        ) : pastGroups.length === 0 && pendingEntries.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No completed group challenges yet.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {pendingEntries.map((entry) => (
              <PastGroupCard key={entry.challenge.id} entry={entry} pending />
            ))}
            {pastGroups.map((entry) => (
              <PastGroupCard key={entry.challenge.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
