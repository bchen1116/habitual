"use client";

import { useEffect, useState } from "react";
import { getClientDb } from "@/lib/firebase/client";
import { chainLongestStreak, walkChain } from "@/lib/chain-streak";
import { longestStreak, streakRun } from "@/lib/streak";
import { cacheGet, cacheSet, chainStreakKey } from "@/lib/client-cache";
import type { ChainCarry } from "@/lib/chain-core";
import type { Challenge } from "@/lib/types";

/**
 * A streak plus how long it's actually been running. `streak` is the ranked
 * number (days checked in); `weeks` is the calendar span of that same run, so
 * a daily habit and a 5×/week habit that have both gone 10 weeks unbroken say
 * so, even though their check-in counts differ.
 */
interface StreakSpan {
  streak: number;
  weeks: number;
}

export interface ChainStreak extends StreakSpan {
  /**
   * True while the numbers above are only the *current cycle's*, with a chain
   * walk still outstanding that can raise them.
   *
   * These hooks deliberately render the single-cycle figure the instant it's
   * known rather than waiting, and that was right for a habit standing on its
   * own. On a repeated habit it isn't: the first cycle of a new repeat has one
   * or two check-ins in it, so the hero painted "1", then corrected itself to
   * "37" once the ancestors were read. A number that changes after you've read
   * it is worse than one that arrives late — "1" isn't a rough draft of "37",
   * it's a different claim. Callers should show a placeholder while this is
   * set, and only ever show a figure they won't have to take back.
   *
   * Never set when the walk can't change the answer: a habit with no earlier
   * cycle has nothing to carry, so its number is final on the first frame.
   */
  pending: boolean;
}

const ZERO_SPAN: StreakSpan = { streak: 0, weeks: 0 };
const ZERO: ChainStreak = { ...ZERO_SPAN, pending: false };
const ZERO_CARRY: ChainCarry = { streak: 0, spanDays: 0 };

/** Whether any habit here even has an ancestor to walk back to. */
function anyChained(challenges: readonly Challenge[]): boolean {
  return challenges.some((c) => !!c.repeatedFromId);
}

function chainEligible(challenge: Challenge, reachesFloor: boolean): boolean {
  return reachesFloor && !challenge.streakResetAt && !!challenge.repeatedFromId;
}

/**
 * Single-challenge chain-aware streak. The current cycle's own numbers are
 * known synchronously; whatever earlier cycles add arrives after a read, and
 * `pending` marks the gap so a caller can hold off rather than print a figure
 * it will have to revise.
 *
 * The carry is memoized on top of the read cache the walk already uses,
 * because they solve different halves of the problem: the read cache stops the
 * network calls repeating, and this stops the *await* repeating. Without it,
 * every return to a page went through one more `pending` frame for data that
 * was already sitting in memory — a skeleton that flashes is its own kind of
 * flicker.
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
  // Keyed on the challenge and its parent link alone: a carry is built purely
  // from *ended* cycles, so today's date and today's check-ins can't move it.
  // Under the "streak:" prefix so the existing invalidations reach it.
  const carryKey = `streak:carry:${uid}:${challenge?.id ?? ""}:${
    challenge?.repeatedFromId ?? ""
  }`;
  const [carry, setCarry] = useState<ChainCarry | null>(
    () => cacheGet<ChainCarry>(carryKey) ?? null
  );

  const eligible = !!challenge && !!local && chainEligible(challenge, local.reachesFloor);

  useEffect(() => {
    if (!challenge || !eligible) {
      setCarry(null);
      return;
    }
    const hit = cacheGet<ChainCarry>(carryKey);
    if (hit) {
      setCarry(hit);
      return;
    }
    let cancelled = false;
    walkChain(getClientDb(), challenge, uid)
      .then((total) => {
        cacheSet(carryKey, total);
        if (!cancelled) setCarry(total);
      })
      .catch(() => {
        // The reader already turns an unreadable ancestor into "the chain ends
        // here", so this only fires on something unforeseen. It still has to
        // settle to *some* carry: a promise that neither resolves nor settles
        // leaves `pending` set, and a placeholder that never resolves into a
        // number is a worse failure than a streak that's short by its history.
        if (!cancelled) setCarry(ZERO_CARRY);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carryKey, eligible]);

  if (!local) return ZERO;
  // An ineligible habit has no carry by definition, so a stale one left in
  // state from a previous render must not be added in.
  const resolved = eligible ? carry : ZERO_CARRY;
  return {
    streak: local.streak + (resolved?.streak ?? 0),
    weeks: Math.floor((local.spanDays + (resolved?.spanDays ?? 0)) / 7),
    pending: eligible && carry === null,
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
  const [chainMax, setChainMax] = useState<StreakSpan | null>(
    () => cacheGet<StreakSpan>(cacheKey) ?? null
  );
  // Distinct from `chainMax === null`, which means "still walking". A walk
  // that failed has also stopped, and conflating the two would leave the
  // biggest number on the home screen as a placeholder that never resolves.
  const [failed, setFailed] = useState(false);

  const localMax = challenges.reduce<StreakSpan>((best, c) => {
    const run = streakRun(
      c,
      checkinYmdsByChallenge[c.id] ?? [],
      today,
      joinedDateByChallenge[c.id]
    );
    return run.streak > best.streak
      ? { streak: run.streak, weeks: Math.floor(run.spanDays / 7) }
      : best;
  }, ZERO_SPAN);

  useEffect(() => {
    setFailed(false);
    if (challenges.length === 0) {
      setChainMax(null);
      return;
    }
    const hit = cacheGet<StreakSpan>(cacheKey);
    if (hit) {
      setChainMax(hit);
      return;
    }
    let cancelled = false;
    const db = getClientDb();
    Promise.all(
      challenges.map(async (c): Promise<StreakSpan> => {
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
      const best = totals.reduce<StreakSpan>(
        (acc, t) => (t.streak > acc.streak ? t : acc),
        ZERO_SPAN
      );
      // Cached even if this render was cancelled: the answer is keyed on its
      // own inputs, so it stays correct for whoever asks next.
      cacheSet(cacheKey, best);
      if (!cancelled) setChainMax(best);
    })
      .catch(() => {
        // Leaves the single-cycle figure standing, which is short of the
        // history but not wrong about this cycle — and, unlike a placeholder,
        // it's an answer.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return {
    ...(chainMax ?? localMax),
    pending: chainMax === null && !failed && anyChained(challenges),
  };
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
 * Same shape as useMaxChainStreak, `pending` included: on a habit with earlier
 * cycles the single-cycle answer is a number this will have to take back, so
 * callers hold a placeholder rather than print it.
 */
export interface ChainBest {
  best: number;
  pending: boolean;
}

export function useMaxChainLongestStreak(
  challenges: readonly Challenge[],
  uid: string,
  checkinYmdsByChallenge: Readonly<Record<string, readonly string[]>>,
  today: string,
  joinedDateByChallenge: Readonly<Record<string, string | undefined>> = {}
): ChainBest {
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
        // is correct as far as it goes rather than wrong. Zero rather than
        // null because null also means "still walking" — parking it there
        // would leave callers showing a placeholder for a walk that has in
        // fact finished, and will never finish again.
        if (!cancelled) setChainBest(0);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return {
    best: Math.max(chainBest ?? 0, localBest),
    pending: chainBest === null && anyChained(challenges),
  };
}
