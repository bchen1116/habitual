import { addDaysYmd } from "@/lib/dates";
import { longestStreak, streakRun } from "@/lib/streak";
import type { Challenge } from "@/lib/types";

// Backstop against a corrupted/cyclic repeatedFromId chain, not a product limit.
const MAX_CHAIN_DEPTH = 500;

/**
 * How a chain walk reads data. Deliberately abstract so the identical walk
 * logic serves both the browser (client Firestore SDK, gated by
 * firestore.rules) and the server (Admin SDK, which bypasses rules) — the
 * leaderboard needs the SAME streak definition the hero shows, and
 * duplicating the gap/floor conditions into a second implementation is how
 * those two silently drift apart.
 */
export interface ChainReader {
  /** Null when the doc is missing OR unreadable — a client can't read an ancestor cycle it wasn't a member of. */
  getChallenge(id: string): Promise<Challenge | null>;
  getCheckinYmds(challengeId: string, uid: string): Promise<string[]>;
  /**
   * The member's own joinedDate on that cycle, or undefined if they weren't in
   * it (or the doc predates the field). Needed so an ancestor cycle someone
   * joined partway through is judged the same way their current one is —
   * repeatChallengeAdmin stamps joinedDate = the new cycle's startDate for
   * everyone carried over, so this only differs for someone who joined that
   * particular cycle late.
   */
  getJoinedDate(challengeId: string, uid: string): Promise<string | undefined>;
}

/**
 * Walks backward through `repeatedFromId` links, summing each ancestor
 * cycle's own trailing streak run for as long as the chain stays unbroken
 * and back-to-back. Stops at the first: missing/unreadable ancestor, calendar
 * gap (repeated late — `addDaysYmd(ancestor.endDate, 1) !== childStartDate`),
 * incomplete run within an ancestor, or an ancestor carrying its own
 * `streakResetAt` (an explicit "restart," same as `streakRun`'s own floor —
 * it shouldn't be chained through either).
 */
export interface ChainCarry {
  /** Check-ins carried in from earlier cycles. */
  streak: number;
  /** Calendar days those cycles cover — cycles are contiguous, so spans add. */
  spanDays: number;
}

export async function walkChainWith(
  reader: ChainReader,
  challenge: Challenge,
  uid: string
): Promise<ChainCarry> {
  let streak = 0;
  let spanDays = 0;
  let childStartDate = challenge.startDate;
  let nextId = challenge.repeatedFromId;
  let depth = 0;

  while (nextId && depth < MAX_CHAIN_DEPTH) {
    depth++;
    const ancestor = await reader.getChallenge(nextId);
    if (!ancestor) break;

    if (addDaysYmd(ancestor.endDate, 1) !== childStartDate) break; // gap: repeated late

    // Independent of each other, so one round trip rather than two. The walk
    // itself stays sequential by nature — whether to look at the next ancestor
    // depends on how this one turned out.
    const [ymds, joinedDate] = await Promise.all([
      reader.getCheckinYmds(ancestor.id, uid),
      reader.getJoinedDate(ancestor.id, uid),
    ]);
    const run = streakRun(
      ancestor,
      ymds,
      addDaysYmd(ancestor.endDate, 1),
      joinedDate
    );
    streak += run.streak;
    spanDays += run.spanDays;

    if (!run.reachesFloor || ancestor.streakResetAt) break;

    childStartDate = ancestor.startDate;
    nextId = ancestor.repeatedFromId;
  }

  return { streak, spanDays };
}

/**
 * Every cycle in a chain, oldest-last, starting from `challenge` and walking
 * back only through contiguous links. Used for an all-time-longest run, which
 * has to see a chain as one timeline: computing per-cycle and taking the max
 * truncates any run that straddles a cycle boundary, so a 3×-repeated 4-week
 * habit could never show a streak longer than 28.
 *
 * Unlike walkChainWith this does NOT stop at a broken run — a chain's earlier
 * cycles are still part of the same continuous timeline even if the habit was
 * missed somewhere along it. It stops only at a missing/unreadable ancestor or
 * a real calendar gap, both of which genuinely break continuity.
 */
export async function collectChainCycles(
  reader: ChainReader,
  challenge: Challenge
): Promise<Challenge[]> {
  const cycles: Challenge[] = [challenge];
  let childStartDate = challenge.startDate;
  let nextId = challenge.repeatedFromId;
  let depth = 0;

  while (nextId && depth < MAX_CHAIN_DEPTH) {
    depth++;
    const ancestor = await reader.getChallenge(nextId);
    if (!ancestor) break;
    if (addDaysYmd(ancestor.endDate, 1) !== childStartDate) break;

    cycles.push(ancestor);
    childStartDate = ancestor.startDate;
    nextId = ancestor.repeatedFromId;
  }

  return cycles;
}

/**
 * A habit's own longest run, measured over its whole repeat-chain as one
 * continuous timeline rather than per-cycle. Cycles in a chain are contiguous
 * whole weeks by construction (repeatChallengeAdmin starts the next cycle at
 * endDate+1, and durations are whole weeks), so a synthetic challenge spanning
 * the earliest start to this cycle's end keeps the weekly window grid aligned
 * while letting a run cross cycle boundaries.
 */
export async function chainLongestStreakWith(
  reader: ChainReader,
  challenge: Challenge,
  uid: string,
  today: string
): Promise<number> {
  const cycles = await collectChainCycles(reader, challenge);
  if (cycles.length === 1) {
    const ymds = await reader.getCheckinYmds(challenge.id, uid);
    return longestStreak(
      challenge,
      ymds,
      today,
      await reader.getJoinedDate(challenge.id, uid)
    );
  }

  // One round trip for the whole chain instead of one per cycle. Order is
  // irrelevant to both results below: longestStreak puts the dates into a Set,
  // and the join date is a minimum.
  const perCycle = await Promise.all(
    cycles.map(async (cycle) => ({
      ymds: await reader.getCheckinYmds(cycle.id, uid),
      joined: await reader.getJoinedDate(cycle.id, uid),
    }))
  );
  const allYmds = perCycle.flatMap((c) => c.ymds);
  // The earliest point they were actually in this habit. A chain can reach
  // back past someone's own membership (the Admin SDK reads cycles they were
  // never part of), and the spanning challenge below starts at the oldest
  // cycle either way — so their effective start is where *they* began, not
  // the chain's start.
  //
  // Membership is decided by memberIds, not by whether a join date came back,
  // because `getJoinedDate` returns undefined for two different situations and
  // they need opposite treatment: a member doc that predates the joinedDate
  // field (legacy — see ChallengeMember.joinedDate, where absent means "here
  // from the start"), and no member doc at all.
  //
  // Taking the minimum of only the dates that *exist* conflated them, and the
  // result was a habit whose best-ever run collapsed to its newest cycle: on a
  // repeat whose ancestor predates the field, the ancestor contributed no date,
  // the successor contributed its own start — written by repeatChallengeAdmin —
  // and that became the floor for the whole chain, marking every earlier day
  // inactive. A run of 8 across the boundary reported 8 as the current streak
  // and 4 as the best ever, which is not just wrong but impossible.
  let joinedDate: string | undefined;
  cycles.forEach((cycle, i) => {
    if (!cycle.memberIds?.includes(uid)) return; // never in this cycle
    const start = perCycle[i].joined ?? cycle.startDate;
    if (!joinedDate || start < joinedDate) joinedDate = start;
  });
  // cycles is newest-first (collectChainCycles walks backward), so the last
  // entry is the oldest cycle and holds the chain's true start.
  const oldest = cycles[cycles.length - 1];
  const spanning: Challenge = {
    ...challenge,
    startDate: oldest.startDate,
    // A chain-wide "best ever" is a historical record; a mid-chain skip-days
    // edit shouldn't erase it, matching streak.ts's stated position that
    // streakResetAt floors the *live* streak only.
    streakResetAt: null,
  };
  return longestStreak(spanning, allYmds, today, joinedDate);
}
