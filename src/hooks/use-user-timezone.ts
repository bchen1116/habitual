"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { browserTimezone } from "@/lib/dates";

/**
 * The user's stored timezone (users/{uid}.timezone) — the authority for
 * day boundaries — falling back to the browser timezone until it loads.
 */
export function useUserTimezone(uid: string): string {
  const [timezone, setTimezone] = useState<string>(browserTimezone());

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(getClientDb(), "users", uid),
      (snap) => {
        const tz = snap.data()?.timezone;
        if (typeof tz === "string" && tz.length > 0) setTimezone(tz);
      },
      () => {
        // keep the browser fallback on error
      }
    );
    return unsubscribe;
  }, [uid]);

  return timezone;
}
