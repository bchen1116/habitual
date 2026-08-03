"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { repeatChallenge } from "@/lib/challenges";
import { addDaysYmd, daysBetweenInclusive, formatYmd } from "@/lib/dates";
import { repeatDurationDays } from "@/lib/duration";
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

interface RepeatChallengeDialogProps {
  challenge: Challenge;
  today: string;
  /** Total members on the ended challenge, including the creator. */
  memberCount: number;
}

/**
 * Creator-only, once a habit has ended (challenge-detail.tsx gates when
 * this renders at all). Starts a new challenge doc with the same name,
 * mode, and frequency; only the stake and skip days are editable.
 *
 * Neither date is user-chosen. The start is today or the day after the old
 * end date, whichever is later, so cycles chain without gaps or overlaps;
 * the length simply repeats the last cycle's, so a weekly habit rolls into
 * the next week and a four-week one into the next four weeks. Both are
 * derived on the server — what is shown here is a preview, not an input.
 * For group habits, every prior member carries over automatically
 * server-side (repeatChallengeAdmin); this dialog just surfaces that as an
 * informational line.
 */
export function RepeatChallengeDialog({
  challenge,
  today,
  memberCount,
}: RepeatChallengeDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const dayAfterOldEnd = addDaysYmd(challenge.endDate, 1);
  const nextStartYmd = today > dayAfterOldEnd ? today : dayAfterOldEnd;
  const durationDays = repeatDurationDays(
    daysBetweenInclusive(challenge.startDate, challenge.endDate)
  );
  const weeks = durationDays / 7;
  const nextEndYmd = addDaysYmd(nextStartYmd, durationDays - 1);

  const [stakeAmount, setStakeAmount] = useState(String(challenge.stakeAmount));
  const [skipDays, setSkipDays] = useState(String(challenge.skipDays));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function reset() {
    setStakeAmount(String(challenge.stakeAmount));
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
    const skipDaysNum = Number(skipDays);
    if (!Number.isFinite(skipDaysNum) || skipDaysNum < 0 || skipDaysNum > 30) {
      setFormError("Skip days must be between 0 and 30.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await repeatChallenge(challenge.id, {
        stakeAmount: amount,
        skipDays: skipDaysNum,
      });
      setOpen(false);
      router.replace(`/challenges/${result.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't repeat this habit.");
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
          Repeat
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Repeat habit</DialogTitle>
          <DialogDescription>
            Runs {weeks} more week{weeks === 1 ? "" : "s"} — {formatYmd(nextStartYmd)}{" "}
            to {formatYmd(nextEndYmd)}, the same length as last time. Same name
            and frequency; adjust the stake or skips below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="repeat-stake">Stake (USD)</Label>
          <Input
            id="repeat-stake"
            inputMode="decimal"
            className="w-32"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="repeat-skip-days">Allowed skips</Label>
          <Input
            id="repeat-skip-days"
            type="number"
            min={0}
            max={30}
            className="w-24"
            value={skipDays}
            onChange={(e) => setSkipDays(e.target.value)}
          />
        </div>

        {challenge.mode === "group" && memberCount > 1 && (
          <p className="text-sm text-muted-foreground">
            Your {memberCount - 1} other member{memberCount - 1 === 1 ? "" : "s"} carry
            over automatically — no one needs to rejoin.
          </p>
        )}
        {formError && <p className="text-sm text-destructive">{formError}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Starting…" : "Start next cycle"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
