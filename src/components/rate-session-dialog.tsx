"use client";

import { useEffect, useState } from "react";
import { MAX_RATING, saveRating } from "@/lib/reflections";
import { Button } from "@/components/ui/button";
import { RatingScale } from "@/components/rating-scale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface RateSessionDialogProps {
  challengeId: string;
  uid: string;
  date: string; // yyyymmdd
  dateLabel: string;
  current: number | null;
  onError: (message: string | null) => void;
}

/**
 * Rate (or re-rate) a session after the fact.
 *
 * The check-in sheet is a one-shot moment: it closes on submit and a check-in
 * can never be repeated for the same day, so without this the only way to
 * rate a session would be to remember at exactly the right second, and a
 * mistyped 2 that meant 9 would stand forever. Reflections are mutable
 * precisely so this can exist.
 */
export function RateSessionDialog({
  challengeId,
  uid,
  date,
  dateLabel,
  current,
  onError,
}: RateSessionDialogProps) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(current);

  // Discard an abandoned edit: reopening should show what's on record, not
  // whatever was left half-selected last time.
  useEffect(() => {
    if (open) setRating(current);
  }, [open, current]);

  // Optimistic and unawaited, like CheckinDialog — see the note on
  // MissReasonDialog.save.
  function save() {
    onError(null);
    saveRating(challengeId, uid, date, rating).catch((err) => {
      console.error("rating save failed:", err);
      onError("Couldn't save that rating. Please try again.");
    });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {current === null ? "Rate this session" : `Rated ${current}/${MAX_RATING} · change`}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How did it go?</DialogTitle>
          <DialogDescription>
            {dateLabel} · private to you, and it doesn&apos;t affect your streak or
            the leaderboard.
          </DialogDescription>
        </DialogHeader>
        <RatingScale value={rating} onChange={setRating} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save}>{rating === null ? "Clear rating" : "Save"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
