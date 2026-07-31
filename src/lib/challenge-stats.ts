import { daysBetweenInclusive } from "@/lib/dates";
import { totalRequired } from "@/lib/progress";
import type { Challenge, MemberOutcome } from "@/lib/types";

export interface CompletedChallengeEntry {
  challenge: Challenge;
  outcome: MemberOutcome;
  completedCount: number;
  /**
   * The member's own joinedDate. Load-bearing for completion percentages:
   * without it a late joiner is measured against the creator's full
   * requirement, so someone who joined a 4-week habit in week three and did
   * every session shows ~50%. Absent on members created before the field
   * existed — totalRequired treats that as "joined at the start", which is
   * what those members were.
   */
  joinedDate?: string;
}

export interface LifetimeStats {
  totalCompleted: number;
  /** Percent 0-100, or null if no completed challenge has a decided outcome. */
  winRate: number | null;
  /** Best completedCount/totalRequired ratio across completed challenges, 0-100. */
  bestCompletionPercent: number;
  totalWagered: number;
  soloCount: number;
  groupCount: number;
  longestChallengeDays: number;
}

/**
 * Lifetime stats from already-decided (adjudicated) challenges only — every
 * input here is a field already frozen on the challenge/member docs at
 * adjudication time, so this never needs a challenge's raw checkin history
 * (that's what a true "longest streak ever" stat would require, and is
 * deliberately not computed here).
 */
export function computeLifetimeStats(entries: CompletedChallengeEntry[]): LifetimeStats {
  const decided = entries.filter((e) => e.outcome !== null);
  const wins = decided.filter((e) => e.outcome === "succeeded").length;

  const completionPercents = entries.map((e) => {
    const total = totalRequired(e.challenge, e.joinedDate);
    return total > 0 ? Math.min(100, (e.completedCount / total) * 100) : 0;
  });

  return {
    totalCompleted: entries.length,
    winRate: decided.length > 0 ? Math.round((wins / decided.length) * 100) : null,
    bestCompletionPercent:
      completionPercents.length > 0 ? Math.round(Math.max(...completionPercents)) : 0,
    totalWagered: entries.reduce((sum, e) => sum + e.challenge.stakeAmount, 0),
    soloCount: entries.filter((e) => e.challenge.mode === "solo").length,
    groupCount: entries.filter((e) => e.challenge.mode === "group").length,
    longestChallengeDays: entries.reduce(
      (max, e) =>
        Math.max(max, daysBetweenInclusive(e.challenge.startDate, e.challenge.endDate)),
      0
    ),
  };
}

/** Mean of `amount` across ledger entries, or null if there are none. */
export function averageAmount(entries: readonly { amount: number }[]): number | null {
  if (entries.length === 0) return null;
  return entries.reduce((sum, e) => sum + e.amount, 0) / entries.length;
}
