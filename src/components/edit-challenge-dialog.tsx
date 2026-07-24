"use client";

import { useState } from "react";
import { editChallenge } from "@/lib/challenges";
import { dateInputToYmd, daysBetweenInclusive, ymdToDateInput } from "@/lib/dates";
import type { Challenge } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface EditChallengeDialogProps {
  challenge: Challenge;
  /** The creator's own current streak on this challenge, as of today. */
  currentStreak: number;
}

/**
 * Creator-only edit for stake/duration/skip days (challenge-detail.tsx
 * gates when this renders at all — solo, or group before anyone else has
 * joined). Raising skip days ends the creator's live streak on this
 * challenge (see streakResetAt in editChallengeAdmin/currentStreak), so
 * this warns inline whenever the entered value is an increase and there's
 * an actual streak to lose — the submit button's own label doubles as the
 * confirmation, no separate dialog needed.
 */
export function EditChallengeDialog({ challenge, currentStreak }: EditChallengeDialogProps) {
  const [open, setOpen] = useState(false);
  const [stakeAmount, setStakeAmount] = useState(String(challenge.stakeAmount));
  const [endDate, setEndDate] = useState(ymdToDateInput(challenge.endDate));
  const [skipDays, setSkipDays] = useState(String(challenge.skipDays));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const skipDaysNum = Number(skipDays);
  const increasesSkips = Number.isFinite(skipDaysNum) && skipDaysNum > challenge.skipDays;
  const willEndStreak = increasesSkips && currentStreak > 0;

  function reset() {
    setStakeAmount(String(challenge.stakeAmount));
    setEndDate(ymdToDateInput(challenge.endDate));
    setSkipDays(String(challenge.skipDays));
    setFormError(null);
  }

  async function submit() {
    setFormError(null);
    const amount = Number(stakeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter a stake amount greater than $0.");
      return;
    }
    const newEndYmd = dateInputToYmd(endDate);
    const days = daysBetweenInclusive(challenge.startDate, newEndYmd);
    if (days % 7 !== 0 || days < 7) {
      setFormError("Duration must be a whole number of weeks.");
      return;
    }
    if (!Number.isFinite(skipDaysNum) || skipDaysNum < 0 || skipDaysNum > 30) {
      setFormError("Skip days must be between 0 and 30.");
      return;
    }

    setSubmitting(true);
    try {
      await editChallenge(challenge.id, {
        stakeAmount: amount,
        endDate: newEndYmd,
        skipDays: skipDaysNum,
      });
      setOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Couldn't update the challenge."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (submitting) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit habit</DialogTitle>
          <DialogDescription>
            Stake, duration, and skip days only — and only while no one else
            has joined.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-stake">Stake (USD)</Label>
          <Input
            id="edit-stake"
            inputMode="decimal"
            className="w-32"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-end-date">Ends</Label>
          <Input
            id="edit-end-date"
            type="date"
            className="w-44"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-skip-days">Allowed skips</Label>
          <Input
            id="edit-skip-days"
            type="number"
            min={0}
            max={30}
            className="w-24"
            value={skipDays}
            onChange={(e) => setSkipDays(e.target.value)}
          />
        </div>

        {willEndStreak && (
          <p className="text-sm text-destructive">
            You have a {currentStreak}-day streak going. Increasing your
            allowed skips ends it — you&apos;ll start a new one from today.
          </p>
        )}
        {formError && <p className="text-sm text-destructive">{formError}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting
              ? "Saving…"
              : willEndStreak
                ? "Save & end streak"
                : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
