"use client";

import { collection, doc, getDoc, getDocs, type Firestore } from "firebase/firestore";
import { addDaysYmd } from "@/lib/dates";
import { streakRun } from "@/lib/streak";
import type { Challenge } from "@/lib/types";

// Backstop against a corrupted/cyclic repeatedFromId chain, not a product limit.
const MAX_CHAIN_DEPTH = 500;

/**
 * Walks backward through `repeatedFromId` links, summing each ancestor
 * cycle's own trailing streak run for as long as the chain stays unbroken
 * and back-to-back. Stops at the first: missing ancestor doc, calendar gap
 * (repeated late — `addDaysYmd(ancestor.endDate, 1) !== childStartDate`),
 * incomplete run within an ancestor, or an ancestor with its own
 * `streakResetAt` (an explicit "restart," same as `currentStreak`'s own
 * floor — it shouldn't be chained through either).
 *
 * Every read here is one-time (`getDoc`/`getDocs`), not a live listener —
 * ancestors are settled history that won't change, unlike the caller's own
 * current-cycle checkins.
 */
export async function walkChain(
  db: Firestore,
  challenge: Challenge,
  uid: string
): Promise<number> {
  let total = 0;
  let childStartDate = challenge.startDate;
  let nextId = challenge.repeatedFromId;
  let depth = 0;

  while (nextId && depth < MAX_CHAIN_DEPTH) {
    depth++;
    const snap = await getDoc(doc(db, "challenges", nextId));
    if (!snap.exists()) break;
    const ancestor = { id: snap.id, ...snap.data() } as Challenge;

    if (addDaysYmd(ancestor.endDate, 1) !== childStartDate) break; // gap: repeated late

    const checkinsSnap = await getDocs(
      collection(db, "challenges", ancestor.id, "checkins")
    );
    const ymds = checkinsSnap.docs
      .map((d) => d.data())
      .filter((c) => c.uid === uid)
      .map((c) => c.localDate as string);

    const run = streakRun(ancestor, ymds, addDaysYmd(ancestor.endDate, 1));
    total += run.streak;

    if (!run.reachesFloor || ancestor.streakResetAt) break;

    childStartDate = ancestor.startDate;
    nextId = ancestor.repeatedFromId;
  }

  return total;
}
