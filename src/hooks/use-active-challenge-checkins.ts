"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { activeChallengesQuery } from "@/lib/challenges";
import type { Challenge } from "@/lib/types";

export interface CheckinRecord {
  localDate: string;
  completedAtMs: number | null;
}

export interface ActiveChallengeActivity {
  challenges: Challenge[] | null;
  checkinsByChallenge: Record<string, CheckinRecord[]>;
  loading: boolean;
}

/**
 * Every active challenge the user belongs to, plus their own check-ins for
 * each — the shared data source behind the streak hero, week strip, and
 * habit rows on Today, so those pieces read from one place instead of each
 * independently subscribing to the same checkins subcollections.
 */
export function useActiveChallengeCheckins(uid: string): ActiveChallengeActivity {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [checkinsByChallenge, setCheckinsByChallenge] = useState<
    Record<string, CheckinRecord[]>
  >({});

  useEffect(() => {
    const unsubscribe = onSnapshot(
      activeChallengesQuery(getClientDb(), uid),
      (snap) => {
        const items = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Challenge
        );
        items.sort((a, b) => a.startDate.localeCompare(b.startDate));
        setChallenges(items);
      },
      () => setChallenges([])
    );
    return unsubscribe;
  }, [uid]);

  const challengeIds = useMemo(
    () => (challenges ?? []).map((c) => c.id).join(","),
    [challenges]
  );

  useEffect(() => {
    const ids = challengeIds ? challengeIds.split(",") : [];
    const unsubscribes = ids.map((id) =>
      onSnapshot(
        collection(getClientDb(), "challenges", id, "checkins"),
        (snap) => {
          const records = snap.docs
            .map((d) => d.data())
            .filter((c) => c.uid === uid)
            .map((c) => ({
              localDate: c.localDate as string,
              completedAtMs:
                (c.completedAt?.toMillis?.() as number | undefined) ?? null,
            }));
          setCheckinsByChallenge((prev) => ({ ...prev, [id]: records }));
        }
      )
    );
    return () => unsubscribes.forEach((u) => u());
  }, [challengeIds, uid]);

  return {
    challenges,
    checkinsByChallenge,
    loading: challenges === null,
  };
}
