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
  /**
   * Spend a banked spare skip on this week, or take one back. Omitted for
   * anything that can't take one — a day, a week still running, a habit that
   * doesn't earn spares, a graded cycle.
   */
  spare?: SpareOffer;
  onClose: () => void;
  onError: (message: string | null) => void;
}

export interface SpareOffer {
  /** Spares already on this week. */
  applied: number;
  /** How many more this week's shortfall could take. */
  room: number;
  /** Spares left in the bank for this habit. */
  available: number;
  /** Sets this week's total; 0 takes them all back. */
  onSet: (count: number) => void;
}

/**
 * Spending a spare, inside the sheet a missed week already opens.
 *
 * No confirm step, unlike the backfill above it, and the difference is the
 * point: a backfill is a claim about what you did and cannot be undone, while
 * a spare is a resource you own and can take straight back while the cycle is
 * still running. A confirmation on a reversible action is just a tax.
 */
function SpareSection({ offer }: { offer: SpareOffer }) {
  const { applied, room, available } = offer;
  const plural = (n: number) => (n === 1 ? "" : "s");

  if (applied > 0) {
    return (
      <div className="rounded-xl border-2 border-input p-3">
        <p className="text-sm">
          <span className="font-medium">
            ◆ {applied} spare{plural(applied)}
          </span>{" "}
          covering this week. {available} left banked.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {room > 0 && available > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => offer.onSet(applied + 1)}
            >
              Use another
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => offer.onSet(0)}>
            Take {applied === 1 ? "it" : "them"} back
          </Button>
        </div>
      </div>
    );
  }

  if (room === 0) return null;

  return (
    <div className="rounded-xl border-2 border-input p-3">
      <p className="text-sm">
        {available > 0 ? (
          <>
            You have{" "}
            <span className="font-medium">
              ◆ {available} spare skip{plural(available)}
            </span>{" "}
            banked. Spending one covers this week so it doesn&apos;t count
            against your stake.
          </>
        ) : (
          <>
            No spare skips banked yet — check in all 7 days of a week to earn
            one. They roll into the next cycle of this habit until you use them.
          </>
        )}
      </p>
      {available > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => offer.onSet(1)}
        >
          Use a spare on this week
        </Button>
      )}
    </div>
  );
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
 * `onBackfill` and `spare` are the two things here that *do* change all three,
 * and they're the two honest answers to something missed: "I did it and forgot
 * to say" for a day, and "I've earned the right to skip one" for a week. They
 * live in the same sheet because a miss only ever gets one tap, and it has to
 * offer everything that tap could mean. They never appear together — a day
 * can't take a spare and a week can't be backfilled — so the sheet shows at
 * most one of them.
 */
export function MissReasonDialog({
  challengeId,
  uid,
  date,
  dateLabel,
  existing,
  onBackfill,
  spare,
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
            {dateLabel} · your answer below is private, and it doesn&apos;t change
            your streak or your stake.
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

        {spare && <SpareSection offer={spare} />}

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
