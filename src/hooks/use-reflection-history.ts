"use client";

import { useEffect, useMemo, useState } from "react";
import { getDocs } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import {
  allMyReflectionsQuery,
  myReflectionsQuery,
  reflectionChallengeId,
} from "@/lib/reflections";
import { firestoreErrorHint } from "@/lib/firestore-errors";
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
  /**
   * Why, when the cause is one we can name — rules or indexes that haven't
   * been deployed yet. Null for anything else, where a guess would be worse
   * than the generic message.
   */
  errorHint: string | null;
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
  const [errorHint, setErrorHint] = useState<string | null>(null);

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
      const db = getClientDb();
      try {
        let results: HabitReflections[];
        try {
          // One collection-group query for every habit at once, instead of one
          // per habit — twenty-five round trips from a phone for a user with a
          // little history.
          const snap = await getDocs(allMyReflectionsQuery(db, uid));
          const byChallenge = new Map<string, Reflection[]>();
          for (const d of snap.docs) {
            const challengeId = reflectionChallengeId(d.ref);
            if (!challengeId) continue;
            const list = byChallenge.get(challengeId);
            if (list) list.push(d.data() as Reflection);
            else byChallenge.set(challengeId, [d.data() as Reflection]);
          }
          results = challenges.map((challenge) => ({
            challengeId: challenge.id,
            name: challenge.name,
            reflections: byChallenge.get(challenge.id) ?? [],
          }));
        } catch (err) {
          // The collection-group index and its read rule deploy separately from
          // the app, so a build can reach production before they do. Falling
          // back to the per-habit queries keeps the page correct — just slower —
          // instead of showing an error for a purely operational gap.
          console.warn(
            "collection-group reflections query unavailable, falling back:",
            err
          );
          results = await Promise.all(
            challenges.map(async (challenge) => {
              const snap = await getDocs(myReflectionsQuery(db, challenge.id, uid));
              return {
                challengeId: challenge.id,
                name: challenge.name,
                reflections: snap.docs.map((d) => d.data() as Reflection),
              };
            })
          );
        }
        if (!cancelled) {
          setHabits(results);
          setError(false);
          setErrorHint(null);
        }
      } catch (err) {
        console.error("reflection history fetch failed:", err);
        if (!cancelled) {
          setError(true);
          setErrorHint(firestoreErrorHint(err));
        }
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

  return { habits, error, errorHint };
}
