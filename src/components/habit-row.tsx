"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { formatInTimeZone } from "date-fns-tz";
import { CheckinDialog } from "@/components/checkin-dialog";
import { HabitWeekStrip } from "@/components/habit-week-strip";
import { challengeState, habitWeek, progressSummary } from "@/lib/progress";
import { useChainStreak } from "@/hooks/use-chain-streak";
import { formatYmd, todayYmd } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import type { CheckinRecord } from "@/hooks/use-active-challenge-checkins";
import type { Challenge } from "@/lib/types";

interface HabitRowProps {
  challenge: Challenge;
  uid: string;
  timezone: string;
  checkins: CheckinRecord[]; // this user's checkins for this challenge
  /** This user's joinedDate on this challenge, for the streak math. */
  joinedDate?: string;
  onError: (message: string | null) => void;
}

/**
 * The Volt spec's 3-state habit row: pending (not yet actionable), done
 * (checked in today), active/up-next (actionable now — gets the volt CTA).
 * "Ended" challenges awaiting adjudication render as pending too, since
 * they're no longer actionable but haven't left the active-challenges query
 * yet (that happens once the nightly cron adjudicates them).
 */
export function HabitRow({
  challenge,
  uid,
  timezone,
  checkins,
  joinedDate,
  onError,
}: HabitRowProps) {
  const today = todayYmd(timezone);
  const checkinYmds = checkins.map((c) => c.localDate);
  const state = challengeState(challenge, today);
  const summary = progressSummary(challenge, checkinYmds, timezone, joinedDate);
  const { streak, pending: streakPending } = useChainStreak(
    challenge,
    uid,
    checkinYmds,
    today,
    joinedDate
  );
  // This habit's own seven days, anchored to its start date rather than to
  // Monday — a habit begun on a Saturday shows S M T W T F S.
  const week = habitWeek(challenge, checkinYmds, today, joinedDate);

  // Pops the ring only on a genuine active -> done transition, not on a
  // page load where the habit was already checked in earlier.
  const wasCheckedRef = useRef(summary.checkedInToday);
  const [justCompleted, setJustCompleted] = useState(false);
  useEffect(() => {
    if (summary.checkedInToday && !wasCheckedRef.current) {
      setJustCompleted(true);
      const timeout = setTimeout(() => setJustCompleted(false), 400);
      wasCheckedRef.current = true;
      return () => clearTimeout(timeout);
    }
    wasCheckedRef.current = summary.checkedInToday;
  }, [summary.checkedInToday]);

  if (state === "upcoming" || state === "ended") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border-2 border-input bg-card px-4 py-3.5 lg:px-5 lg:py-4">
        <span className="min-w-0 flex-1 truncate text-[17px] font-bold lg:text-[19px]">
          {challenge.name}
        </span>
        <span className="type-overline shrink-0 text-xs text-muted-foreground">
          {state === "upcoming"
            ? `Starts ${formatYmd(challenge.startDate)}`
            : "Awaiting results"}
        </span>
      </div>
    );
  }

  if (summary.checkedInToday) {
    const todaysCheckin = checkins.find((c) => c.localDate === today);
    const time = todaysCheckin?.completedAtMs
      ? formatInTimeZone(new Date(todaysCheckin.completedAtMs), timezone, "h:mm a")
      : null;
    return (
      <div className="rounded-2xl bg-card px-4 py-3.5 lg:px-5 lg:py-4">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[17px] font-bold text-muted-foreground line-through lg:text-[19px]">
            {challenge.name}
          </span>
          {/* The tick moved from the left of the name to the right of it, with
              the time. It's the one circle in this list that meant something —
              the other two were empty rings that read as unchecked radios you
              could press — but leaving it on the left would have started done
              rows' titles 44px further in than every other row's. Here it
              keeps saying "done" and costs the title nothing. */}
          <span className="flex shrink-0 items-center gap-2">
            <motion.span
              animate={justCompleted ? { scale: [0.7, 1.2, 1] } : { scale: 1 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-primary"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </motion.span>
            {time && (
              <span className="type-overline text-xs text-muted-foreground">
                {time}
              </span>
            )}
          </span>
        </div>
        {week && <HabitWeekStrip week={week} tone="volt" dense className="mt-3" />}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-foreground bg-card px-4 py-3.5 lg:px-5 lg:py-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-extrabold lg:text-[19px]">
            {challenge.name}
          </p>
          {/* No nudge text beside the badge any more: the check-in button
              squeezes this column to about two words on a phone, and the week
              strip below now says the same thing with real numbers. */}
          {/* An em-dash while the chain walk is out: this row sits directly
              under the hero, and a repeated habit would otherwise show its
              one-cycle streak and correct itself a beat later. */}
          <Badge variant="volt" className="mt-1">
            Streak {streakPending ? "—" : streak}
          </Badge>
        </div>
        <div className="shrink-0">
          <CheckinDialog
            challenge={challenge}
            uid={uid}
            today={today}
            timezone={timezone}
            onError={onError}
          />
        </div>
      </div>
      {week && <HabitWeekStrip week={week} tone="volt" dense className="mt-3" />}
    </div>
  );
}
