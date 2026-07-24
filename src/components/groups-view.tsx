"use client";

import { useActiveChallengeCheckins } from "@/hooks/use-active-challenge-checkins";
import { useChallengeHistory } from "@/hooks/use-challenge-history";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { GroupCard } from "@/components/group-card";
import { PastGroupCard } from "@/components/past-group-card";

export function GroupsView({ uid }: { uid: string }) {
  const timezone = useUserTimezone(uid);
  const { challenges, loading } = useActiveChallengeCheckins(uid);
  const { entries: history, error: historyError } = useChallengeHistory(uid);

  const groupChallenges = (challenges ?? []).filter((c) => c.mode === "group");
  const pastGroups = (history ?? [])
    .filter((e) => e.challenge.mode === "group")
    .sort((a, b) => b.challenge.endDate.localeCompare(a.challenge.endDate));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-5 lg:p-9">
      <div>
        <h1 className="type-display text-3xl">Groups</h1>

        {loading && <div className="mt-4 h-32 animate-pulse rounded-2xl bg-muted" />}

        {!loading && groupChallenges.length === 0 && (
          <div className="mt-4 rounded-2xl bg-card px-4 py-6 text-center">
            <p className="font-bold">No active groups</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Join or start a group challenge to see it here.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          {groupChallenges.map((c) => (
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
        ) : pastGroups.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No completed group challenges yet.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {pastGroups.map((entry) => (
              <PastGroupCard key={entry.challenge.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
