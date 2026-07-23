"use client";

import { useActiveChallengeCheckins } from "@/hooks/use-active-challenge-checkins";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { GroupCard } from "@/components/group-card";

export function GroupsView({ uid }: { uid: string }) {
  const timezone = useUserTimezone(uid);
  const { challenges, loading } = useActiveChallengeCheckins(uid);
  const groupChallenges = (challenges ?? []).filter((c) => c.mode === "group");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-5 lg:p-9">
      <h1 className="type-display text-3xl">Groups</h1>

      {loading && <div className="h-32 animate-pulse rounded-2xl bg-muted" />}

      {!loading && groupChallenges.length === 0 && (
        <div className="rounded-2xl bg-card px-4 py-6 text-center">
          <p className="font-bold">No groups yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Join or start a group challenge to see it here.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {groupChallenges.map((c) => (
          <GroupCard key={c.id} challenge={c} timezone={timezone} />
        ))}
      </div>
    </div>
  );
}
