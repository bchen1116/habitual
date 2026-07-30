"use client";

import { useState } from "react";
import { checkIn } from "@/lib/challenges";
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
  today: string; // yyyymmdd in the user's timezone
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
export function CheckinDialog({ challenge, uid, today, onError }: CheckinDialogProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [rating, setRating] = useState<number | null>(null);

  function submit() {
    onError(null);
    checkIn(challenge, uid, today, note).catch(() => {
      onError("Check-in failed — it may be past the allowed window. Please try again.");
    });
    if (rating !== null) {
      // Swallowed on purpose: the check-in above is the thing that matters,
      // and reporting "your rating didn't save" over the top of a successful
      // check-in would read as the check-in having failed.
      saveRating(challenge.id, uid, today, rating).catch((err) =>
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
          <DialogDescription>Mark today as done.</DialogDescription>
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
