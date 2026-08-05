"use client";

import { useEffect, useState } from "react";
import { todayYmd } from "@/lib/dates";

/**
 * The habit date, kept current for as long as the app is open.
 *
 * `todayYmd` is a pure function of the clock, so a value computed during a
 * render is only right until the clock crosses the 3am rollover. That is
 * usually academic. Here it isn't: the app is installed to a home screen
 * (`display: standalone` in the manifest), so a session routinely spans days
 * — the tab is suspended when the phone locks and resumed the next morning
 * without ever unmounting. Nothing forced a re-render in between, so the date
 * every component held was the one from whenever the app was last awake.
 *
 * A check-in tapped in that state was written against the *previous* habit
 * date, and both outcomes are bad:
 *
 * - If that day was already checked in, the write collided with the document
 *   already there. Check-ins are create-only (firestore.rules), so it was
 *   denied and nothing happened — the person taps Check in, sees an error or
 *   nothing at all, and today stays unmarked.
 * - If that day had been missed, it backfilled it. The ±1-day window in the
 *   rules is meant to stop exactly that, and a client one day behind sits
 *   inside the window, so the rule waves it through.
 *
 * Recomputed when the page becomes visible — the resume case, and the one
 * that actually bites — and on a slow interval for a tab left open across the
 * boundary. `setState` is called only when the string genuinely changes, so
 * the timer costs a string comparison a minute and causes no renders on the
 * 1,439 minutes a day when the answer is the same.
 */
export function useHabitDate(timezone: string): string {
  const [date, setDate] = useState(() => todayYmd(timezone));

  useEffect(() => {
    const sync = () =>
      setDate((prev) => {
        const next = todayYmd(timezone);
        return next === prev ? prev : next;
      });

    // Immediately, because mounting is itself a moment the clock may have
    // moved since — a remount after a long suspension lands here first.
    sync();
    const interval = setInterval(sync, 60_000);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, [timezone]);

  return date;
}
