"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useActiveChallengeCheckins,
  type ActiveChallengeActivity,
} from "@/hooks/use-active-challenge-checkins";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import type { ActivitySnapshot } from "@/lib/types";

export interface ActivityValue extends ActiveChallengeActivity {
  /** users/{uid}.timezone, falling back to the browser's. */
  timezone: string;
  /** Carried so consumers don't need it threaded down as a prop as well. */
  uid: string;
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
  const { challenges, checkinsByChallenge, joinedDateByChallenge, loading, error } =
    useActiveChallengeCheckins(uid, initial);
  const timezone = useUserTimezone(uid, initial?.timezone);

  const value = useMemo<ActivityValue>(
    () => ({
      challenges,
      checkinsByChallenge,
      joinedDateByChallenge,
      loading,
      error,
      timezone,
      uid,
    }),
    [
      challenges,
      checkinsByChallenge,
      joinedDateByChallenge,
      loading,
      error,
      timezone,
      uid,
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
