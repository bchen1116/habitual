"use client";

import { useState } from "react";
import { checkIn } from "@/lib/challenges";
import {
  DAY_CUTOFF_HOUR,
  formatYmd,
  isBeforeDayCutoff,
  todayYmd,
} from "@/lib/dates";
import { saveRating } from "@/lib/reflections";
import type { Challenge } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { RatingScale } from "@/components/rating-scale";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface CheckinDialogProps {
  challenge: Challenge;
  uid: string;
  today: string; // yyyymmdd habit date in the user's timezone
  timezone: string;
  onError: (message: string | null) => void;
}

/**
 * Bottom sheet (mobile) / modal (desktop) confirming today's check-in, with
 * an optional 1–10 rating of how the session went and an optional note.
 * Optimistic: the write is NOT awaited — the local Firestore cache updates
 * listeners instantly (also the only behavior that works offline, where the
 * promise won't resolve until reconnect). A rules rejection reverts the
 * listener state and surfaces via onError.
 *
 * The rating is deliberately optional and deliberately not required to move
 * past this sheet. Check-ins carry money and streaks; making people answer a
 * question to claim one would either be resented or answered reflexively, and
 * a reflexive rating is worse than no rating. Its write is a separate,
 * separately-failing promise for the same reason — it must never be able to
 * cost someone a check-in (see the Reflection docblock in lib/types.ts).
 */
export function CheckinDialog({
  challenge,
  uid,
  today,
  timezone,
  onError,
}: CheckinDialogProps) {
  const [open, setOpen] = useState(false);
  const beforeCutoff = isBeforeDayCutoff(timezone);
  const [note, setNote] = useState("");
  const [rating, setRating] = useState<number | null>(null);

  function submit() {
    onError(null);
    // Read from the clock here rather than trusting the `today` prop, which
    // was captured when the row rendered. Two things can have moved since: a
    // sheet opened at 02:59 and confirmed at 03:01 belongs to the new habit
    // day, and an installed app resumed the morning after it was last awake
    // is holding yesterday's date until something refreshes it. Both wrote to
    // the wrong document; see useHabitDate.
    const localDate = todayYmd(timezone);
    checkIn(challenge, uid, localDate, note).catch(() => {
      onError(
        "Check-in didn't save. If you've already checked in for today it's " +
          "still recorded — otherwise check your connection and try again."
      );
    });
    if (rating !== null) {
      // Swallowed on purpose: the check-in above is the thing that matters,
      // and reporting "your rating didn't save" over the top of a successful
      // check-in would read as the check-in having failed.
      //
      // Same date as the check-in, necessarily — a rating filed against a
      // different day than the session it rates is worse than no rating.
      saveRating(challenge.id, uid, localDate, rating).catch((err) =>
        console.error("rating save failed:", err)
      );
    }
    setNote("");
    setRating(null);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Check in for today</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{challenge.name}</DialogTitle>
          {/* Between midnight and 3am the habit date on screen is yesterday's,
              which is the whole point of the cutoff — but unexplained it looks
              like the check-in landed on the wrong day. */}
          <DialogDescription>
            {beforeCutoff
              ? `Still counts for ${formatYmd(today)} — the day rolls over at ${DAY_CUTOFF_HOUR}am.`
              : "Mark today as done."}
          </DialogDescription>
        </DialogHeader>
        <div>
          <p className="type-overline mb-2 text-xs text-muted-foreground">
            How did it go? (optional)
          </p>
          <RatingScale value={rating} onChange={setRating} />
        </div>
        <Textarea
          placeholder="Add a note (optional)"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Check in</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
