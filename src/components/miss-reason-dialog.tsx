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
  /**
   * Log this day as done after the fact. Omitted when the day isn't eligible
   * (see canBackfill) — a cycle already graded, a date outside it, a day
   * already logged — so the offer only ever appears where it can succeed.
   */
  onBackfill?: () => void;
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
 * The reason itself affects nothing — not the streak, not the stake, not the
 * leaderboard — and the sheet says so, because with real money on the line
 * the unspoken assumption would otherwise be that it's an appeal.
 *
 * `onBackfill` is the one thing here that *does* change all three, which is
 * why it's a separate confirm step rather than another button in the same
 * row. The two live together because they're the two honest answers to a day
 * that was missed — "I did it and forgot to say" and "here's what happened" —
 * and a day only ever gets one tap to offer both.
 */
export function MissReasonDialog({
  challengeId,
  uid,
  date,
  dateLabel,
  existing,
  onBackfill,
  onClose,
  onError,
}: MissReasonDialogProps) {
  const [reason, setReason] = useState<MissReason | null>(null);
  const [note, setNote] = useState("");
  const [confirmingBackfill, setConfirmingBackfill] = useState(false);

  // Reset to whatever is on record each time a different day is opened —
  // without the date in the deps, reopening on a second day would show the
  // first day's answer already filled in.
  useEffect(() => {
    setReason(existing?.missReason ?? null);
    setNote(existing?.missNote ?? "");
    // Reopening on another day must never land mid-confirmation, or a tap
    // meant for one date would log a different one.
    setConfirmingBackfill(false);
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

  if (confirmingBackfill && onBackfill) {
    return (
      <Dialog open={date !== null} onOpenChange={(next) => !next && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log {dateLabel} as done?</DialogTitle>
            <DialogDescription>
              Only if you actually did it. This counts exactly like checking in
              on the day — toward your streak, and toward whether your stake is
              safe — and it&apos;s recorded as logged later rather than on the
              day. Check-ins can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmingBackfill(false)}>
              Back
            </Button>
            <Button
              onClick={() => {
                onBackfill();
                onClose();
              }}
            >
              Yes, I did it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
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

        {onBackfill && (
          <div className="rounded-xl border-2 border-input p-3">
            <p className="text-sm">
              Did you actually do this and forget to log it?
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setConfirmingBackfill(true)}
            >
              I did this — log it
            </Button>
          </div>
        )}

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
