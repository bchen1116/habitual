"use client";

import { collection, doc, getDoc, getDocs, type Firestore } from "firebase/firestore";
import { walkChainWith, type ChainCarry, type ChainReader } from "@/lib/chain-core";
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
