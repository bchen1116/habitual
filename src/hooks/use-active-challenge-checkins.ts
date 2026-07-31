"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
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
  /**
   * The user's own joinedDate per challenge, for the streak math — a
   * weekly_count window joined partway through is prorated rather than judged
   * against the full target (see streakRun). Absent until the member doc
   * loads, and legitimately absent for members created before the field
   * existed; both mean "treat them as here from the start", which is what
   * effectiveStart already does with undefined.
   */
  joinedDateByChallenge: Record<string, string | undefined>;
  loading: boolean;
  /**
   * True on a genuine query failure — permissions, network, a missing
   * index. Checked separately from `challenges`: an empty `challenges`
   * array on its own means "genuinely zero active challenges," and must
   * stay that way regardless of whether the query ever failed, so
   * consumers can tell "you have none" from "this couldn't load" instead
   * of a failure quietly reading as an empty state.
   */
  error: boolean;
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
  const [joinedDateByChallenge, setJoinedDateByChallenge] = useState<
    Record<string, string | undefined>
  >({});
  const [error, setError] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      activeChallengesQuery(getClientDb(), uid),
      (snap) => {
        const items = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Challenge
        );
        items.sort((a, b) => a.startDate.localeCompare(b.startDate));
        setChallenges(items);
        setError(false);
      },
      (err) => {
        // Previously set challenges to [] here — indistinguishable from a
        // real "you have zero active challenges" result, so a fetch
        // failure silently read as an empty state instead of an error.
        console.error("active challenges query failed:", err);
        setError(true);
      }
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
          // Keyed to the challenges currently active, so a habit that has since
          // been adjudicated or cancelled drops out instead of accumulating
          // for the life of the session — its listener is already gone by the
          // time this runs, so its entry could never be refreshed again.
          setCheckinsByChallenge((prev) => {
            const next: Record<string, CheckinRecord[]> = { [id]: records };
            for (const key of ids) if (key !== id && prev[key]) next[key] = prev[key];
            return next;
          });
        },
        (err) => console.error(`checkins query failed for challenge ${id}:`, err)
      )
    );
    return () => unsubscribes.forEach((u) => u());
  }, [challengeIds, uid]);

  // One-time reads rather than listeners: joinedDate is stamped once when
  // membership is granted and never changes afterward, so a subscription per
  // habit would cost the same as the check-in listeners above to watch a
  // value that cannot move.
  useEffect(() => {
    const ids = challengeIds ? challengeIds.split(",") : [];
    if (ids.length === 0) {
      setJoinedDateByChallenge({});
      return;
    }
    let cancelled = false;
    const db = getClientDb();
    Promise.all(
      ids.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, "challenges", id, "members", uid));
          return [id, snap.data()?.joinedDate as string | undefined] as const;
        } catch (err) {
          console.error(`member doc read failed for challenge ${id}:`, err);
          return [id, undefined] as const;
        }
      })
    ).then((pairs) => {
      if (!cancelled) setJoinedDateByChallenge(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [challengeIds, uid]);

  return {
    challenges,
    checkinsByChallenge,
    joinedDateByChallenge,
    loading: challenges === null && !error,
    error,
  };
}
