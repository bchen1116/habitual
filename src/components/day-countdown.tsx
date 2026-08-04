"use client";

import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  COUNTDOWN_LEAD_MS,
  formatCountdown,
  msUntilDayCutoff,
  nextDayCutoff,
} from "@/lib/day-deadline";
import { cn } from "@/lib/utils";

/** Below this the display switches to mm:ss and the card takes an urgent tone. */
const FINAL_STRETCH_MS = 60 * 60 * 1000;

/**
 * How long is left to log today's habits, in the last hours before the day
 * rolls over.
 *
 * Renders nothing at all for most of the day, and nothing ever if there's
 * nothing outstanding — a permanent clock would be pressure without
 * information, and a clock counting down to a deadline you've already met is
 * just noise. It appears when both are true: the deadline is close, and
 * something still needs doing about it.
 *
 * The deadline is 03:00, not midnight (see DAY_CUTOFF_HOUR). That's the point
 * of the whole component: at 00:30 a midnight countdown would already have
 * expired, telling someone they'd missed a day they can still log.
 */
export function DayCountdown({
  timezone,
  /** Habits that can still be logged today and haven't been. Zero hides this. */
  outstanding,
}: {
  timezone: string;
  outstanding: number;
}) {
  // Null until mounted: `new Date()` on the server and on the client are
  // different instants, and this renders that difference as text.
  const [now, setNow] = useState<Date | null>(null);

  const msLeft = now ? msUntilDayCutoff(timezone, now) : Infinity;
  const showing = outstanding > 0 && msLeft <= COUNTDOWN_LEAD_MS;
  const finalStretch = msLeft <= FINAL_STRETCH_MS;

  useEffect(() => {
    setNow(new Date());
    // Once a second only while it's on screen and counting seconds. The rest
    // of the day this is a minute-hand: it exists to notice the window
    // opening, which happens on a minute boundary, and a 1Hz timer running
    // for the twenty hours nobody is looking at it is pure battery.
    const period = showing && finalStretch ? 1000 : 30_000;
    const id = setInterval(() => setNow(new Date()), period);
    return () => clearInterval(id);
  }, [showing, finalStretch]);

  if (!now || !showing) return null;

  const deadlineLabel = formatInTimeZone(
    nextDayCutoff(timezone, now),
    timezone,
    "h:mm a"
  );
  const remaining = formatCountdown(msLeft);

  return (
    <div
      // role="timer" carries no implicit live region, so this doesn't
      // interrupt a screen reader every second — but the label still says the
      // whole thing to anyone who lands on it.
      role="timer"
      aria-label={`${remaining} left to log ${outstanding} habit${
        outstanding === 1 ? "" : "s"
      }, by ${deadlineLabel}`}
      className={cn(
        "flex items-center gap-3 rounded-2xl border-2 px-4 py-3 lg:px-5",
        finalStretch
          ? "border-destructive bg-destructive/10"
          : "border-input bg-card"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "type-display shrink-0 text-2xl leading-none tabular-nums lg:text-3xl",
          finalStretch && "text-destructive"
        )}
      >
        {remaining}
      </span>
      <span aria-hidden className="min-w-0 text-sm text-muted-foreground">
        left to log{" "}
        <span className="font-semibold text-foreground">
          {outstanding} habit{outstanding === 1 ? "" : "s"}
        </span>{" "}
        — the day rolls over at {deadlineLabel}
      </span>
    </div>
  );
}
