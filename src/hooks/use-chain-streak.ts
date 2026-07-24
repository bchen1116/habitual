"use client";

import { useEffect, useState } from "react";
import { getClientDb } from "@/lib/firebase/client";
import { walkChain } from "@/lib/chain-streak";
import { streakRun, maxCurrentStreak } from "@/lib/streak";
import type { Challenge } from "@/lib/types";

function chainEligible(challenge: Challenge, reachesFloor: boolean): boolean {
  return reachesFloor && !challenge.streakResetAt && !!challenge.repeatedFromId;
}

/**
 * Single-challenge chain-aware streak. Returns the local (single-cycle)
 * number immediately — identical to `currentStreak(...)` — and upgrades to
 * the full cross-cycle total once the ancestor walk resolves. Never a
 * flash-of-zero: the total only ever grows from the local value.
 */
export function useChainStreak(
  challenge: Challenge | null | undefined,
  uid: string,
  checkinYmds: readonly string[],
  today: string
): number {
  const local = challenge ? streakRun(challenge, checkinYmds, today) : null;
  const [ancestorStreak, setAncestorStreak] = useState(0);

  const eligible = !!challenge && !!local && chainEligible(challenge, local.reachesFloor);

  useEffect(() => {
    if (!challenge || !eligible) {
      setAncestorStreak(0);
      return;
    }
    let cancelled = false;
    walkChain(getClientDb(), challenge, uid).then((total) => {
      if (!cancelled) setAncestorStreak(total);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, challenge?.repeatedFromId, eligible, uid]);

  return (local?.streak ?? 0) + ancestorStreak;
}

/**
 * The largest chain-aware current streak across a set of active challenges
 * (the dashboard hero / sidebar number). One effect fans out a walk per
 * challenge rather than calling useChainStreak per item, since the list
 * length varies and the rules of hooks don't allow a variable number of
 * hook calls.
 */
export function useMaxChainStreak(
  challenges: readonly Challenge[],
  uid: string,
  checkinYmdsByChallenge: Readonly<Record<string, readonly string[]>>,
  today: string
): number {
  const localMax = maxCurrentStreak(challenges, checkinYmdsByChallenge, today);
  const [chainMax, setChainMax] = useState<number | null>(null);

  const checkinsKey = challenges
    .map((c) => `${c.id}:${(checkinYmdsByChallenge[c.id] ?? []).join("|")}`)
    .join(",");
  const chainKey = challenges.map((c) => `${c.id}:${c.repeatedFromId ?? ""}`).join(",");

  useEffect(() => {
    if (challenges.length === 0) {
      setChainMax(null);
      return;
    }
    let cancelled = false;
    const db = getClientDb();
    Promise.all(
      challenges.map(async (c) => {
        const ymds = checkinYmdsByChallenge[c.id] ?? [];
        const local = streakRun(c, ymds, today);
        const ancestorTotal = chainEligible(c, local.reachesFloor)
          ? await walkChain(db, c, uid)
          : 0;
        return local.streak + ancestorTotal;
      })
    ).then((totals) => {
      if (!cancelled) setChainMax(totals.length > 0 ? Math.max(...totals) : 0);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey, checkinsKey, uid, today]);

  return chainMax ?? localMax;
}
