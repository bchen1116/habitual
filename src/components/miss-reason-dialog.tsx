"use client";

import { useEffect, useState } from "react";
import {
  MAX_MISS_NOTE_LENGTH,
  MISS_REASONS,
  saveMissReason,
} from "@/lib/reflections";
import type { MissReason, Reflection } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface MissReasonDialogProps {
  challengeId: string;
  uid: string;
  /** yyyymmdd of the missed day (or window start). Null closes the dialog. */
  date: string | null;
  /** Human label for what was missed — "Mon, Jul 13", "Week 2 · Jul 7 – Jul 13". */
  dateLabel: string;
  existing: Reflection | undefined;
  onClose: () => void;
  onError: (message: string | null) => void;
}

/**
 * "What got in the way?" for a day (or weekly window) that was missed.
 *
 * This is the one moment the app already knows something went wrong, and
 * until now it only ever responded by silently zeroing a number. Asking here
 * costs nothing on the days things go fine — it fires only on a miss — and
 * it's the moment people are actually reflective rather than defensive.
 *
 * Nothing recorded here affects the streak, the stake, or the leaderboard.
 * That's stated in the sheet too, because with real money on the line the
 * unspoken assumption would otherwise be that this is an appeal.
 */
export function MissReasonDialog({
  challengeId,
  uid,
  date,
  dateLabel,
  existing,
  onClose,
  onError,
}: MissReasonDialogProps) {
  const [reason, setReason] = useState<MissReason | null>(null);
  const [note, setNote] = useState("");

  // Reset to whatever is on record each time a different day is opened —
  // without the date in the deps, reopening on a second day would show the
  // first day's answer already filled in.
  useEffect(() => {
    setReason(existing?.missReason ?? null);
    setNote(existing?.missNote ?? "");
  }, [date, existing?.missReason, existing?.missNote]);

  const recorded = Boolean(existing?.missReason);

  /**
   * Optimistic, and not awaited — the same reasoning as CheckinDialog. The
   * local Firestore cache updates the page's listener immediately, so the
   * day's marker appears at once; awaiting instead would leave the sheet
   * stuck on "Saving…" for the whole time someone is offline, which is
   * exactly when "what got in the way" is most likely to be answered.
   */
  function save(nextReason: MissReason | null) {
    if (!date) return;
    onError(null);
    saveMissReason(challengeId, uid, date, nextReason, note).catch((err) => {
      console.error("miss reason save failed:", err);
      onError("Couldn't save that note. Please try again.");
    });
    onClose();
  }

  return (
    <Dialog open={date !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What got in the way?</DialogTitle>
          <DialogDescription>
            {dateLabel} · private to you, and it doesn&apos;t change your streak or
            your stake.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {MISS_REASONS.map((option) => {
            const selected = reason === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setReason(selected ? null : option.key)}
                className={cn(
                  "rounded-full px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground hover:bg-accent"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <Textarea
          placeholder="Anything else? (optional)"
          value={note}
          maxLength={MAX_MISS_NOTE_LENGTH}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="flex justify-end gap-2">
          {recorded && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => save(null)}
            >
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={reason === null} onClick={() => save(reason)}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
