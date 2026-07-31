"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, getDocs } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { completedChallengesQuery } from "@/lib/challenges";
import type { CompletedChallengeEntry } from "@/lib/challenge-stats";
import type { Challenge, ChallengeMember } from "@/lib/types";

export interface ChallengeHistory {
  entries: CompletedChallengeEntry[] | null; // null while loading
  error: boolean;
}

/**
 * One-time fetch (not live) of every challenge the user has completed.
 * Adjudicated challenges are frozen forever, so — unlike the Today page's
 * live per-challenge listeners — there's no need to keep a subscription
 * open per historical challenge here.
 */
export function useChallengeHistory(uid: string): ChallengeHistory {
  const [entries, setEntries] = useState<CompletedChallengeEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(false);

    (async () => {
      try {
        const db = getClientDb();
        const snap = await getDocs(completedChallengesQuery(db, uid));
        const challenges = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Challenge
        );

        const results = await Promise.all(
          challenges.map(async (challenge) => {
            const memberSnap = await getDoc(
              doc(db, "challenges", challenge.id, "members", uid)
            );
            const member = memberSnap.data() as ChallengeMember | undefined;
            return {
              challenge,
              outcome: member?.outcome ?? null,
              completedCount: member?.completedCount ?? 0,
              joinedDate: member?.joinedDate,
            };
          })
        );

        if (!cancelled) setEntries(results);
      } catch (err) {
        console.error("challenge history fetch failed:", err);
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  return { entries, error };
}
