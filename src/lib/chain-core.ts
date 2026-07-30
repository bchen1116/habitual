import { addDaysYmd } from "@/lib/dates";
import { streakRun } from "@/lib/streak";
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
export async function walkChainWith(
  reader: ChainReader,
  challenge: Challenge,
  uid: string
): Promise<number> {
  let total = 0;
  let childStartDate = challenge.startDate;
  let nextId = challenge.repeatedFromId;
  let depth = 0;

  while (nextId && depth < MAX_CHAIN_DEPTH) {
    depth++;
    const ancestor = await reader.getChallenge(nextId);
    if (!ancestor) break;

    if (addDaysYmd(ancestor.endDate, 1) !== childStartDate) break; // gap: repeated late

    const ymds = await reader.getCheckinYmds(ancestor.id, uid);
    const run = streakRun(ancestor, ymds, addDaysYmd(ancestor.endDate, 1));
    total += run.streak;

    if (!run.reachesFloor || ancestor.streakResetAt) break;

    childStartDate = ancestor.startDate;
    nextId = ancestor.repeatedFromId;
  }

  return total;
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
