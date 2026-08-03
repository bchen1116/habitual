"use client";

import { collection, doc, getDoc, getDocs, type Firestore } from "firebase/firestore";
import {
  chainLongestStreakWith,
  collectChainCycles,
  walkChainWith,
  type ChainCarry,
  type ChainReader,
} from "@/lib/chain-core";
import type { Challenge } from "@/lib/types";

/**
 * Client-side chain reader. Every read here is one-time (`getDoc`/`getDocs`),
 * not a live listener — ancestors are settled history that won't change,
 * unlike the caller's own current-cycle checkins.
 *
 * A missing ancestor and an *unreadable* one collapse to the same `null`: if
 * this user wasn't a member of an earlier cycle, firestore.rules denies the
 * read (`challenges/{cid}` requires `request.auth.uid in resource.data
 * .memberIds`). Swallowing that is correct here — the chain just stops at the
 * boundary of what this viewer can see — but it must not reject, or it would
 * surface as an unhandled rejection in the hooks that call this without a
 * `.catch()`.
 */
function clientChainReader(db: Firestore): ChainReader {
  return {
    async getChallenge(id) {
      try {
        const snap = await getDoc(doc(db, "challenges", id));
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() } as Challenge;
      } catch {
        return null;
      }
    },
    async getCheckinYmds(challengeId, uid) {
      try {
        const snap = await getDocs(
          collection(db, "challenges", challengeId, "checkins")
        );
        return snap.docs
          .map((d) => d.data())
          .filter((c) => c.uid === uid)
          .map((c) => c.localDate as string);
      } catch {
        return [];
      }
    },
    async getJoinedDate(challengeId, uid) {
      try {
        const snap = await getDoc(
          doc(db, "challenges", challengeId, "members", uid)
        );
        return snap.data()?.joinedDate as string | undefined;
      } catch {
        // Same swallow as above: undefined means "treat them as having been
        // here from the start", which is exactly what a member doc predating
        // the field means anyway.
        return undefined;
      }
    },
  };
}

/** Cross-cycle streak carried in from a habit's earlier cycles. See walkChainWith. */
export async function walkChain(
  db: Firestore,
  challenge: Challenge,
  uid: string
): Promise<ChainCarry> {
  return walkChainWith(clientChainReader(db), challenge, uid);
}

/**
 * A habit's best-ever run across its whole repeat chain. The same walk the
 * leaderboard does server-side (computeStreaks), so the number someone sees on
 * their own Progress page and the one they're ranked by can't disagree.
 */
export async function chainLongestStreak(
  db: Firestore,
  challenge: Challenge,
  uid: string,
  today: string
): Promise<number> {
  return chainLongestStreakWith(clientChainReader(db), challenge, uid, today);
}

/** One earlier cycle of a habit, with this viewer's record of it. */
export interface PastCycle {
  challenge: Challenge;
  checkinYmds: string[];
  joinedDate?: string;
}

/**
 * Every earlier cycle of this habit the viewer can see, oldest first, with
 * their own check-ins in each — so a repeated habit can show one continuous
 * history instead of starting from nothing every cycle.
 *
 * Unlike walkChain this doesn't stop at a broken run (collectChainCycles
 * doesn't either): a week you missed two cycles ago is still part of the
 * record, and hiding it would make the history a highlight reel. It stops
 * only at a real calendar gap or a cycle this viewer can't read — someone who
 * joined the group late sees the history from where they joined, which is the
 * only history that was ever theirs.
 */
export async function collectPastCycles(
  db: Firestore,
  challenge: Challenge,
  uid: string
): Promise<PastCycle[]> {
  const reader = clientChainReader(db);
  const cycles = await collectChainCycles(reader, challenge);
  const ancestors = cycles.slice(1).reverse(); // drop `challenge` itself; oldest first
  return Promise.all(
    ancestors.map(async (c) => {
      const [checkinYmds, joinedDate] = await Promise.all([
        reader.getCheckinYmds(c.id, uid),
        reader.getJoinedDate(c.id, uid),
      ]);
      return { challenge: c, checkinYmds, joinedDate };
    })
  );
}
