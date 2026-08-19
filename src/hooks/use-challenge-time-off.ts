"use client";

import { useEffect, useMemo, useState } from "react";

export interface MemberTimeOff {
  awayDays: string[];
  steppedOut: boolean;
}

/** Same shape, with the days as a Set — what every progress function takes. */
export interface ResolvedTimeOff {
  days: ReadonlySet<string>;
  steppedOut: boolean;
}

const NONE: Record<string, ResolvedTimeOff> = {};

/**
 * Everyone's excused days in this cycle, for the members list.
 *
 * A fetch rather than a listener, and that is the honest trade rather than a
 * shortcut. The underlying data is `users/{uid}.awayRanges`, which the rules
 * make owner-only, so there is no client subscription to be had — only a
 * server route that can read it on the viewer's behalf. What that costs is
 * liveness: if someone books time off while you have the page open, their
 * row updates on your next visit rather than instantly.
 *
 * That cost is small because of a rule elsewhere: a range must start strictly
 * after the booker's own local today (lib/server/away-admin.ts), so nothing
 * booked while you're looking at the page can change what's being asked of
 * anyone *today*. Only tomorrow onwards, which you'll see tomorrow.
 *
 * Failures resolve to "nobody is away" rather than an error state. This
 * decorates a list that is already correct about check-ins, and a members
 * card that renders without the decoration is a much better outcome than one
 * that refuses to render at all.
 */
export function useChallengeTimeOff(
  challengeId: string | null | undefined,
  /** Group habits only — a solo cycle has nobody else to describe. */
  enabled: boolean
): Record<string, ResolvedTimeOff> {
  const [raw, setRaw] = useState<Record<string, MemberTimeOff>>({});

  useEffect(() => {
    if (!challengeId || !enabled) {
      setRaw({});
      return;
    }
    let cancelled = false;
    fetch(`/api/challenges/${challengeId}/time-off`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) setRaw(body?.members ?? {});
      })
      .catch(() => {
        if (!cancelled) setRaw({});
      });
    return () => {
      cancelled = true;
    };
  }, [challengeId, enabled]);

  // Memoised on `raw`, whose identity only changes when a fetch resolves —
  // without this the Sets are rebuilt every render and every consumer's own
  // memo is defeated by a new object identity.
  return useMemo(() => {
    const entries = Object.entries(raw);
    if (entries.length === 0) return NONE;
    return Object.fromEntries(
      entries.map(([uid, value]) => [
        uid,
        { days: new Set(value.awayDays), steppedOut: value.steppedOut },
      ])
    );
  }, [raw]);
}
