"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { browserTimezone } from "@/lib/dates";
import type { AwayRange } from "@/lib/types";

export interface UserSettings {
  /** The authority for day boundaries; browser timezone until it loads. */
  timezone: string;
  /** Declared time off — see lib/away.ts. Empty until the snapshot lands. */
  awayRanges: AwayRange[];
}

/**
 * The parts of users/{uid} that every screen needs.
 *
 * One listener for both, deliberately. Timezone and time off live in the same
 * document and are wanted in the same places, so a separate `useAwayRanges`
 * would have re-opened exactly the per-component duplication the shell-level
 * ActivityProvider was built to remove — seven live listeners on one user doc
 * was the measured starting point there.
 *
 * `awayRanges` is empty rather than undefined while loading, and empty on a
 * read error. Both mean "nothing is excused", which is the strict reading: a
 * screen that can't confirm time off asks for the day, and the adjudicator
 * (which reads the same field with the Admin SDK) is the one that decides
 * anyway.
 */
export function useUserSettings(
  uid: string,
  /**
   * Already read on the server. Skips the browser-timezone fallback for the
   * common case, so a traveller's dates don't render in the wrong zone for
   * the moment before the snapshot lands.
   */
  initial?: { timezone?: string | null; awayRanges?: AwayRange[] | null }
): UserSettings {
  const [timezone, setTimezone] = useState<string>(
    initial?.timezone || browserTimezone()
  );
  const [awayRanges, setAwayRanges] = useState<AwayRange[]>(
    initial?.awayRanges ?? []
  );

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(getClientDb(), "users", uid),
      (snap) => {
        const tz = snap.data()?.timezone;
        if (typeof tz === "string" && tz.length > 0) setTimezone(tz);
        const ranges = snap.data()?.awayRanges;
        // Replaced only when it's really an array: a malformed field should
        // leave the last good value alone rather than silently un-booking
        // someone's holiday.
        if (Array.isArray(ranges)) setAwayRanges(ranges as AwayRange[]);
      },
      () => {
        // keep the browser fallback, and no time off
      }
    );
    return unsubscribe;
  }, [uid]);

  return { timezone, awayRanges };
}
