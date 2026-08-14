"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useActiveChallengeCheckins,
  type ActiveChallengeActivity,
} from "@/hooks/use-active-challenge-checkins";
import { useHabitDate } from "@/hooks/use-habit-date";
import { useUserSettings } from "@/hooks/use-user-settings";
import { memberTimeOff } from "@/lib/away";
import { liveChallenges } from "@/lib/cycles";
import type { ActivitySnapshot, AwayRange, Challenge } from "@/lib/types";

export interface ActivityValue extends ActiveChallengeActivity {
  /** users/{uid}.timezone, falling back to the browser's. */
  timezone: string;
  /** Carried so consumers don't need it threaded down as a prop as well. */
  uid: string;
  /**
   * The habit date, in the viewer's timezone. Derived once here rather than
   * per component: nine call sites each ran todayYmd(timezone) on every
   * render, and — more importantly than the wasted Intl formatting — two of
   * them rendering either side of the 3am rollover would have disagreed about
   * what day it is, which is enough to make the sidebar and the page show
   * different streaks.
   */
  today: string;
  /**
   * checkinsByChallenge reduced to bare date arrays, which is the shape every
   * streak and progress function actually takes.
   *
   * Memoised, and that is the point rather than a nicety. The streak hooks
   * build their cache keys by joining every check-in date in this map on each
   * render; when three components each rebuilt the map from scratch, those
   * keys were recomputed from a new object every time and no downstream memo
   * could hold. One stable object means the work happens when the data
   * changes, not when anything re-renders.
   */
  checkinYmdsByChallenge: Record<string, string[]>;
  /**
   * One entry per habit, nothing that has already ended — what an "active
   * habits" list should show (see lib/cycles.ts). Shared so the sidebar, Today
   * and Progress cannot disagree about which habits are live.
   */
  activeChallenges: Challenge[];
  /** The viewer's declared time off, unbudgeted — see lib/away.ts. */
  awayRanges: AwayRange[];
  /**
   * Days each habit actually excuses, already budgeted against that habit's
   * own length.
   *
   * Derived once, here, and this is the whole reason it's on the context: the
   * same fact reached the same functions through several routes last time
   * (`joinedDate`), and both bugs it caused were a call site that had the
   * fact available and didn't pass it. A single map means a consumer either
   * looks a habit up or doesn't — there is no second way to compute it and
   * therefore no second answer.
   */
  awayByChallenge: Record<string, Set<string>>;
}

const ActivityContext = createContext<ActivityValue | null>(null);

/**
 * One subscription to the viewer's habits, for the whole app.
 *
 * Before this, `useActiveChallengeCheckins` was called independently by the
 * sidebar, Today, Groups and Stats — so on three of those pages the identical
 * query, the identical per-habit check-in listeners, and the identical member
 * reads all ran twice. `useUserTimezone` was worse: seven call sites, one of
 * them *inside* the habit card, so a Habits page with five habits held seven
 * live listeners on a single user document.
 *
 * Mounted from AppShell, which sits inside the (app) layout — and layouts are
 * not re-rendered on navigation between sibling routes, so these listeners
 * are opened once per session rather than once per page view. Moving between
 * tabs now reuses data that is already live instead of resubscribing to it.
 *
 * The sidebar is the reason this lives at the shell level rather than per
 * page: it renders a streak on every route, so something has to hold this
 * subscription everywhere regardless. Given that, a second copy for the page
 * was pure duplication.
 */
export function ActivityProvider({
  uid,
  initial,
  children,
}: {
  uid: string;
  /** Server-prefetched, so the first paint has content. Null = load client-side. */
  initial: ActivitySnapshot | null;
  children: ReactNode;
}) {
  // Destructured rather than held as one object, so the memo below can depend
  // on the individual pieces. The hook returns a fresh object every render, so
  // depending on that would defeat the memo entirely — and without a working
  // memo the context value changes on every render of the shell and re-renders
  // every consumer beneath it. Each field here is a useState value with a
  // stable identity, so this genuinely holds.
  const {
    challenges,
    checkinsByChallenge,
    joinedDateByChallenge,
    excludedByChallenge,
    loading,
    error,
  } = useActiveChallengeCheckins(uid, initial);
  const { timezone, awayRanges } = useUserSettings(uid, {
    timezone: initial?.timezone,
    awayRanges: initial?.awayRanges,
  });

  // Not memoised on [timezone], and not merely recomputed per render either:
  // the habit date changes with the clock, which is not a value React can
  // depend on, and an installed PWA can go a whole night without re-rendering.
  // useHabitDate refreshes it on resume and on a slow tick — see the hook for
  // what a stale date did to a check-in.
  const today = useHabitDate(timezone);

  const checkinYmdsByChallenge = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(checkinsByChallenge).map(([id, records]) => [
          id,
          records.map((r) => r.localDate),
        ])
      ),
    [checkinsByChallenge]
  );

  const activeChallenges = useMemo(
    () => liveChallenges(challenges ?? [], today),
    [challenges, today]
  );

  // Every habit the viewer is in, not only the live ones: the Progress page
  // and the history on a habit page both render cycles that have ended, and
  // a settled cycle's skipped days are part of its record.
  const awayByChallenge = useMemo(() => {
    const byChallenge: Record<string, Set<string>> = {};
    for (const challenge of challenges ?? []) {
      const excluded = excludedByChallenge[challenge.id] === true;
      // Nothing booked and not excused means nothing to compute — the common
      // case, and the reason this isn't unconditional work per habit.
      if (awayRanges.length === 0 && !excluded) continue;
      byChallenge[challenge.id] = memberTimeOff(
        challenge,
        awayRanges,
        joinedDateByChallenge[challenge.id],
        excluded
      ).days;
    }
    return byChallenge;
  }, [challenges, awayRanges, joinedDateByChallenge, excludedByChallenge]);

  const value = useMemo<ActivityValue>(
    () => ({
      challenges,
      checkinsByChallenge,
      joinedDateByChallenge,
      excludedByChallenge,
      loading,
      error,
      timezone,
      uid,
      today,
      checkinYmdsByChallenge,
      activeChallenges,
      awayRanges,
      awayByChallenge,
    }),
    [
      challenges,
      checkinsByChallenge,
      joinedDateByChallenge,
      excludedByChallenge,
      loading,
      error,
      timezone,
      uid,
      today,
      checkinYmdsByChallenge,
      activeChallenges,
      awayRanges,
      awayByChallenge,
    ]
  );

  return (
    <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>
  );
}

/**
 * Throws rather than returning a default, because a silent default here is a
 * page that renders "no habits yet" to someone who has plenty.
 */
export function useActivity(): ActivityValue {
  const value = useContext(ActivityContext);
  if (!value) {
    throw new Error("useActivity must be used within ActivityProvider (AppShell)");
  }
  return value;
}
