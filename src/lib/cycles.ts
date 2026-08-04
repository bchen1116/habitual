import { daysBetweenInclusive } from "@/lib/dates";
import { challengeState } from "@/lib/progress";
import type { Challenge } from "@/lib/types";

/** Whole weeks a cycle spans — the arithmetic both repeat writers use. */
export function cycleWeeks(challenge: Challenge): number {
  return Math.floor(
    daysBetweenInclusive(challenge.startDate, challenge.endDate) / 7
  );
}

/**
 * Each cycle's week-number offset, oldest first, worked out from the chain
 * itself instead of taken on trust from `weeksBefore`.
 *
 * `weeksBefore` is stored rather than derived for a good reason — Today
 * renders a week strip per habit and can't afford a read per ancestor just to
 * print a label — but it was added to both repeat writers long after either
 * of them shipped. Every cycle created before that has no value at all, reads
 * as 0, and starts counting from week 1 again, which is how a habit's history
 * ends up listing week 1 twice.
 *
 * Anywhere the ancestors are already loaded, the offset is knowable exactly
 * and there's no reason to trust the field. `Math.max` of the two, because
 * each is a lower bound on the truth and they fail in opposite directions:
 * the stored value is short on legacy data, and the derived one is short when
 * the viewer can't read an earlier cycle (a member who joined the group late
 * is denied it by the rules, and the chain just stops there for them).
 */
export function chainWeekOffsets(cycles: readonly Challenge[]): number[] {
  const offsets: number[] = [];
  let running = 0;
  for (const cycle of cycles) {
    const before = Math.max(cycle.weeksBefore ?? 0, running);
    offsets.push(before);
    running = before + cycleWeeks(cycle);
  }
  return offsets;
}

/**
 * What belongs in a list of someone's habits, given that a habit and a
 * challenge are not the same thing.
 *
 * Every cycle of a repeating habit is its own `challenges/{id}` document —
 * that's what lets each one settle its own stake and freeze its own results.
 * But "Morning run" is one habit to the person doing it, and two of them side
 * by side on Today is a list that has stopped describing their life. Cycles
 * overlap in the query for real reasons: auto-repeat builds the successor a
 * day before the predecessor ends (it has to, or the streak breaks), and
 * manual Repeat can be pressed any time after an end date, both while the old
 * cycle is still `status: "active"` and waiting to be graded.
 *
 * So a chain collapses to whichever of its cycles is the one you'd actually
 * act on today.
 *
 * The other half is `status`, which is a poor answer to "is this running?".
 * It only turns from "active" to "adjudicated" when the nightly job grades
 * the challenge, and that job deliberately waits 39 hours past the end date
 * for the last timezone on earth to finish its final day. A habit that ended
 * yesterday is therefore still stored as active, with nothing left to check
 * into — listing it under Active is just wrong. The end date decides.
 */

/** Backstop against a corrupted/cyclic repeatedFromId chain, not a product limit. */
const MAX_CHAIN_DEPTH = 500;

export interface CycleSplit {
  /**
   * One entry per habit: still running, or not started yet. What an "active
   * habits" list should show.
   */
  live: Challenge[];
  /**
   * Habits past their end date that the nightly job hasn't graded yet. Not
   * live — there's nothing left to do in them — but not history either, since
   * the result isn't known. Listing them somewhere matters: money moves when
   * they're graded, and a habit that vanished for two days and came back
   * owing $20 would be a worse surprise than the wait.
   *
   * A chain whose successor is already running produces no entry here: the
   * successor represents the habit, and a second card for the cycle behind it
   * is the duplication this module exists to prevent.
   */
  awaitingResults: Challenge[];
}

/**
 * The id every cycle of one chain agrees on: the oldest ancestor still
 * present in `byId`. Cycles whose predecessor has already been graded (and so
 * isn't in an active-challenges query) are their own root, which is right —
 * they're the only cycle of that habit still in play.
 */
function chainKey(challenge: Challenge, byId: Map<string, Challenge>): string {
  let current = challenge;
  let depth = 0;
  while (current.repeatedFromId && depth < MAX_CHAIN_DEPTH) {
    const parent = byId.get(current.repeatedFromId);
    if (!parent || parent.id === current.id) break;
    current = parent;
    depth++;
  }
  return current.id;
}

/**
 * Which cycle of a chain stands for the habit today: the one you're inside,
 * or failing that the one about to start, or failing that the most recent.
 *
 * Cycles are contiguous and non-overlapping by construction, so at most one
 * can contain today and the first branch is unambiguous.
 */
function representative(cycles: Challenge[], today: string): Challenge {
  const running = cycles.find((c) => c.startDate <= today && today <= c.endDate);
  if (running) return running;

  const upcoming = cycles
    .filter((c) => c.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (upcoming.length > 0) return upcoming[0];

  return cycles.reduce((latest, c) =>
    c.endDate.localeCompare(latest.endDate) > 0 ? c : latest
  );
}

/**
 * Collapses repeat chains to one cycle each, then separates the ones still in
 * play from the ones waiting to be graded. Input order is preserved in both
 * lists so callers keep whatever sort they applied.
 */
export function splitActiveChallenges(
  challenges: readonly Challenge[],
  today: string
): CycleSplit {
  const byId = new Map(challenges.map((c) => [c.id, c]));
  const chains = new Map<string, Challenge[]>();
  for (const challenge of challenges) {
    const key = chainKey(challenge, byId);
    const group = chains.get(key);
    if (group) group.push(challenge);
    else chains.set(key, [challenge]);
  }

  const chosen = new Set(
    Array.from(chains.values(), (cycles) => representative(cycles, today).id)
  );

  const live: Challenge[] = [];
  const awaitingResults: Challenge[] = [];
  for (const challenge of challenges) {
    if (!chosen.has(challenge.id)) continue;
    // Enumerated rather than defaulted: callers pass an already-filtered
    // active query today, but "anything that isn't ended is live" would put a
    // cancelled or already-graded cycle in the active list the first time one
    // reached here, and that is exactly the class of bug this module is for.
    switch (challengeState(challenge, today)) {
      case "active":
      case "upcoming":
        live.push(challenge);
        break;
      case "ended":
        awaitingResults.push(challenge);
        break;
      case "cancelled":
      case "adjudicated":
        break; // finished business — belongs to history, not either list
    }
  }
  return { live, awaitingResults };
}

/** Just the live half, for callers with nowhere to put the pending ones. */
export function liveChallenges(
  challenges: readonly Challenge[],
  today: string
): Challenge[] {
  return splitActiveChallenges(challenges, today).live;
}
