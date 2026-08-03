"use client";

import { useEffect, useState } from "react";
import { getClientDb } from "@/lib/firebase/client";
import { chainLongestStreak, walkChain } from "@/lib/chain-streak";
import { longestStreak, streakRun } from "@/lib/streak";
import { cacheGet, cacheSet, chainStreakKey } from "@/lib/client-cache";
import type { Challenge } from "@/lib/types";

/**
 * A streak plus how long it's actually been running. `streak` is the ranked
 * number (days checked in); `weeks` is the calendar span of that same run, so
 * a daily habit and a 5×/week habit that have both gone 10 weeks unbroken say
 * so, even though their check-in counts differ.
 */
export interface ChainStreak {
  streak: number;
  weeks: number;
}

const ZERO: ChainStreak = { streak: 0, weeks: 0 };

function chainEligible(challenge: Challenge, reachesFloor: boolean): boolean {
  return reachesFloor && !challenge.streakResetAt && !!challenge.repeatedFromId;
}

/**
 * Single-challenge chain-aware streak. Returns the local (single-cycle)
 * numbers immediately and upgrades to the full cross-cycle totals once the
 * ancestor walk resolves. Never a flash-of-zero: the total only ever grows
 * from the local value.
 */
export function useChainStreak(
  challenge: Challenge | null | undefined,
  uid: string,
  checkinYmds: readonly string[],
  today: string,
  /** This member's own joinedDate — prorates a weekly window they joined into. */
  joinedDate?: string
): ChainStreak {
  const local = challenge
    ? streakRun(challenge, checkinYmds, today, joinedDate)
    : null;
  const [carry, setCarry] = useState({ streak: 0, spanDays: 0 });

  const eligible = !!challenge && !!local && chainEligible(challenge, local.reachesFloor);

  useEffect(() => {
    if (!challenge || !eligible) {
      setCarry({ streak: 0, spanDays: 0 });
      return;
    }
    let cancelled = false;
    walkChain(getClientDb(), challenge, uid).then((total) => {
      if (!cancelled) setCarry(total);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, challenge?.repeatedFromId, eligible, uid]);

  if (!local) return ZERO;
  return {
    streak: local.streak + carry.streak,
    weeks: Math.floor((local.spanDays + carry.spanDays) / 7),
  };
}

/**
 * The largest chain-aware current streak across a set of active challenges
 * (the dashboard hero / sidebar number), together with that same habit's
 * span. One effect fans out a walk per challenge rather than calling
 * useChainStreak per item, since the list length varies and the rules of
 * hooks don't allow a variable number of hook calls.
 *
 * The weeks reported belong to whichever habit produced the winning streak,
 * not the longest-running habit overall — otherwise the header and subheader
 * would describe two different habits.
 */
export function useMaxChainStreak(
  challenges: readonly Challenge[],
  uid: string,
  checkinYmdsByChallenge: Readonly<Record<string, readonly string[]>>,
  today: string,
  joinedDateByChallenge: Readonly<Record<string, string | undefined>> = {}
): ChainStreak {
  const checkinsKey = challenges
    .map((c) => `${c.id}:${(checkinYmdsByChallenge[c.id] ?? []).join("|")}`)
    .join(",");
  // streakResetAt has to be in this key too: chainEligible below depends on
  // it, and it changes live (an in-place edit on an already-mounted
  // challenge doc, not a new/removed challenge), so leaving it out let the
  // effect skip re-running after an edit — stranding chainMax on its
  // stale, too-high pre-edit value until something else happened to touch
  // chainKey/checkinsKey.
  // joinedDate belongs in the key for the same reason streakResetAt does: it
  // feeds streakRun below and lands asynchronously (the member docs are read
  // after the challenge list), so without it the effect would settle on
  // numbers computed before any join date was known.
  const chainKey = challenges
    .map(
      (c) =>
        `${c.id}:${c.repeatedFromId ?? ""}:${c.streakResetAt ?? ""}:${
          joinedDateByChallenge[c.id] ?? ""
        }`
    )
    .join(",");

  const cacheKey = chainStreakKey("current", uid, today, chainKey, checkinsKey);
  // Seeded from the cache, so navigating away and back paints the real number
  // on the first frame instead of falling back to the single-cycle figure and
  // visibly correcting itself once the chain walk resolves again.
  const [chainMax, setChainMax] = useState<ChainStreak | null>(
    () => cacheGet<ChainStreak>(cacheKey) ?? null
  );

  const localMax = challenges.reduce<ChainStreak>((best, c) => {
    const run = streakRun(
      c,
      checkinYmdsByChallenge[c.id] ?? [],
      today,
      joinedDateByChallenge[c.id]
    );
    return run.streak > best.streak
      ? { streak: run.streak, weeks: Math.floor(run.spanDays / 7) }
      : best;
  }, ZERO);

  useEffect(() => {
    if (challenges.length === 0) {
      setChainMax(null);
      return;
    }
    const hit = cacheGet<ChainStreak>(cacheKey);
    if (hit) {
      setChainMax(hit);
      return;
    }
    let cancelled = false;
    const db = getClientDb();
    Promise.all(
      challenges.map(async (c): Promise<ChainStreak> => {
        const ymds = checkinYmdsByChallenge[c.id] ?? [];
        const local = streakRun(c, ymds, today, joinedDateByChallenge[c.id]);
        const carry = chainEligible(c, local.reachesFloor)
          ? await walkChain(db, c, uid)
          : { streak: 0, spanDays: 0 };
        return {
          streak: local.streak + carry.streak,
          weeks: Math.floor((local.spanDays + carry.spanDays) / 7),
        };
      })
    ).then((totals) => {
      const best = totals.reduce<ChainStreak>(
        (acc, t) => (t.streak > acc.streak ? t : acc),
        ZERO
      );
      // Cached even if this render was cancelled: the answer is keyed on its
      // own inputs, so it stays correct for whoever asks next.
      cacheSet(cacheKey, best);
      if (!cancelled) setChainMax(best);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return chainMax ?? localMax;
}

/**
 * Best-ever run across a set of habits, counting each habit's earlier cycles
 * as part of the same timeline.
 *
 * Without the chain walk this reported only what the *current* cycle could
 * show, so repeating a habit reset your all-time best to at most the length of
 * one cycle — a 30-day run across three 2-week cycles displayed as 14. The
 * leaderboard has always walked the chain for this (computeStreaks); the
 * Progress page hadn't, so your own best-ever and your ranked best-ever were
 * two different numbers.
 *
 * Same shape as useMaxChainStreak: the single-cycle answer renders
 * immediately and is replaced by the chain total once the reads land, so the
 * number only ever grows and never flashes zero.
 */
export function useMaxChainLongestStreak(
  challenges: readonly Challenge[],
  uid: string,
  checkinYmdsByChallenge: Readonly<Record<string, readonly string[]>>,
  today: string,
  joinedDateByChallenge: Readonly<Record<string, string | undefined>> = {}
): number {
  const checkinsKey = challenges
    .map((c) => `${c.id}:${(checkinYmdsByChallenge[c.id] ?? []).join("|")}`)
    .join(",");
  const chainKey = challenges
    .map(
      (c) =>
        `${c.id}:${c.repeatedFromId ?? ""}:${joinedDateByChallenge[c.id] ?? ""}`
    )
    .join(",");
  const cacheKey = chainStreakKey("longest", uid, today, chainKey, checkinsKey);

  const [chainBest, setChainBest] = useState<number | null>(
    () => cacheGet<number>(cacheKey) ?? null
  );

  const localBest = challenges.reduce(
    (best, c) =>
      Math.max(
        best,
        longestStreak(
          c,
          checkinYmdsByChallenge[c.id] ?? [],
          today,
          joinedDateByChallenge[c.id]
        )
      ),
    0
  );

  useEffect(() => {
    if (challenges.length === 0) {
      setChainBest(null);
      return;
    }
    const hit = cacheGet<number>(cacheKey);
    if (hit !== undefined) {
      setChainBest(hit);
      return;
    }
    let cancelled = false;
    const db = getClientDb();
    Promise.all(
      challenges.map((c) =>
        c.repeatedFromId
          ? chainLongestStreak(db, c, uid, today)
          : Promise.resolve(
              longestStreak(
                c,
                checkinYmdsByChallenge[c.id] ?? [],
                today,
                joinedDateByChallenge[c.id]
              )
            )
      )
    )
      .then((bests) => {
        const best = Math.max(0, ...bests);
        cacheSet(cacheKey, best);
        if (!cancelled) setChainBest(best);
      })
      .catch(() => {
        // An unreadable ancestor already collapses to "chain ends here" in the
        // reader; anything past that leaves the local figure standing, which
        // is correct as far as it goes rather than wrong.
        if (!cancelled) setChainBest(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return Math.max(chainBest ?? 0, localBest);
}
