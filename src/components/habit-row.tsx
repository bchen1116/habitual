"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { formatInTimeZone } from "date-fns-tz";
import { CheckinDialog } from "@/components/checkin-dialog";
import { challengeState, progressSummary } from "@/lib/progress";
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
  onError: (message: string) => void;
}

/**
 * The Volt spec's 3-state habit row: pending (not yet actionable), done
 * (checked in today), active/up-next (actionable now — gets the volt CTA).
 * "Ended" challenges awaiting adjudication render as pending too, since
 * they're no longer actionable but haven't left the active-challenges query
 * yet (that happens once the nightly cron adjudicates them).
 */
export function HabitRow({ challenge, uid, timezone, checkins, onError }: HabitRowProps) {
  const today = todayYmd(timezone);
  const checkinYmds = checkins.map((c) => c.localDate);
  const state = challengeState(challenge, today);
  const summary = progressSummary(challenge, checkinYmds, timezone);
  const { streak } = useChainStreak(challenge, uid, checkinYmds, today);

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
        <span className="h-8 w-8 shrink-0 rounded-full border-2 border-input" />
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
      <div className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 lg:px-5 lg:py-4">
        <motion.span
          animate={justCompleted ? { scale: [0.7, 1.2, 1] } : { scale: 1 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-primary"
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </motion.span>
        <span className="min-w-0 flex-1 truncate text-[17px] font-bold text-muted-foreground line-through lg:text-[19px]">
          {challenge.name}
        </span>
        {time && (
          <span className="type-overline shrink-0 text-xs text-[#bbbbbb]">{time}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border-2 border-foreground bg-card px-4 py-3.5 lg:px-5 lg:py-4">
      <span className="h-8 w-8 shrink-0 rounded-full border-2 border-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[17px] font-extrabold lg:text-[19px]">
          {challenge.name}
        </p>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <Badge variant="volt" className="shrink-0">
            Streak {streak}
          </Badge>
          <span className="type-overline truncate text-xs text-muted-foreground">
            Don&apos;t break it
          </span>
        </div>
      </div>
      <div className="shrink-0">
        <CheckinDialog challenge={challenge} uid={uid} today={today} onError={onError} />
      </div>
    </div>
  );
}
