"use client";

import { useEffect, useMemo, useState } from "react";
import { getDocs } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { myReflectionsQuery } from "@/lib/reflections";
import type { Reflection } from "@/lib/types";

export interface HabitReflections {
  challengeId: string;
  name: string;
  reflections: Reflection[];
}

export interface ReflectionHistory {
  habits: HabitReflections[] | null; // null while loading
  /**
   * True on a genuine failure. Separate from an empty `habits`, which is the
   * legitimate "you haven't rated anything yet" answer — the codebase has
   * conflated those two before (see useActiveChallengeCheckins).
   */
  error: boolean;
}

/**
 * Every reflection the user has written, across the habits they name.
 *
 * One-time reads rather than listeners: this backs the lifetime Progress view,
 * which is a look back rather than something that needs to move as you check
 * in — and holding an open subscription per habit ever created would be a
 * steep price for a number that changes at most once a day.
 */
export function useReflectionHistory(
  uid: string,
  challenges: { id: string; name: string }[] | null
): ReflectionHistory {
  const [habits, setHabits] = useState<HabitReflections[] | null>(null);
  const [error, setError] = useState(false);

  // Refetch when the *set* of habits changes, not when its containing array is
  // rebuilt — the callers derive theirs from live snapshots, so a fresh array
  // arrives on every unrelated check-in.
  const key = useMemo(
    () =>
      (challenges ?? [])
        .map((c) => c.id)
        .sort()
        .join(","),
    [challenges]
  );

  useEffect(() => {
    if (challenges === null) return;
    let cancelled = false;

    (async () => {
      try {
        const db = getClientDb();
        const results = await Promise.all(
          challenges.map(async (challenge) => {
            const snap = await getDocs(myReflectionsQuery(db, challenge.id, uid));
            return {
              challengeId: challenge.id,
              name: challenge.name,
              reflections: snap.docs.map((d) => d.data() as Reflection),
            };
          })
        );
        if (!cancelled) {
          setHabits(results);
          setError(false);
        }
      } catch (err) {
        console.error("reflection history fetch failed:", err);
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `challenges` is intentionally not a dependency: `key` is its stable
    // identity, and depending on the array itself would refetch on every
    // snapshot that rebuilt it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key, challenges === null]);

  return { habits, error };
}
