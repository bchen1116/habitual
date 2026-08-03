"use client";

import { useEffect, useState } from "react";
import { getClientDb } from "@/lib/firebase/client";
import { collectPastCycles, type PastCycle } from "@/lib/chain-streak";
import type { Challenge } from "@/lib/types";

const NONE: PastCycle[] = [];

/**
 * The earlier cycles of a repeated habit, with this viewer's check-ins in
 * each, so the habit page can show one continuous record rather than
 * restarting at nothing every time the habit rolls over.
 *
 * One-time reads, like the rest of the chain walk: an ancestor cycle is
 * settled history and can't change. Returns an empty list — never a loading
 * flag — while it resolves, so the current cycle renders immediately and the
 * earlier ones appear above it when they arrive. A history that is briefly
 * short is a better failure than a page that waits on reads it may not even
 * be allowed to make.
 */
export function usePastCycles(
  challenge: Challenge | null | undefined,
  uid: string
): PastCycle[] {
  const [cycles, setCycles] = useState<PastCycle[]>(NONE);
  const chainRoot = challenge?.repeatedFromId ?? null;

  useEffect(() => {
    if (!challenge || !chainRoot) {
      setCycles(NONE);
      return;
    }
    let cancelled = false;
    collectPastCycles(getClientDb(), challenge, uid)
      .then((result) => {
        if (!cancelled) setCycles(result);
      })
      .catch(() => {
        // Unreadable ancestors already collapse to "chain ends here" inside
        // the reader; anything reaching here is a genuine failure, and the
        // current cycle's own history is still correct without them.
        if (!cancelled) setCycles(NONE);
      });
    return () => {
      cancelled = true;
    };
    // Keyed on the ids, not the challenge object: it arrives from an
    // onSnapshot listener and is a fresh object every time anything in the
    // doc changes, so depending on it directly would re-read the whole chain
    // on every check-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, chainRoot, uid]);

  return cycles;
}
