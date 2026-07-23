"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { joinChallenge } from "@/lib/challenges";
import { formatAmount } from "@/lib/ledger";
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

/**
 * The join action on /join/[code] for a signed-in, non-member user.
 * Confirms the stake and collects the joiner's own charity (docs/04:
 * each member picks their own).
 */
export function JoinPanel({
  joinCode,
  stakeAmount,
}: {
  joinCode: string;
  stakeAmount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [charityName, setCharityName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (!charityName.trim()) {
      setError("Name the charity you'd owe if you fail.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const challengeId = await joinChallenge(joinCode, charityName.trim());
      router.replace(`/challenges/${challengeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
      <DialogTrigger asChild>
        <Button size="lg">Join challenge</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join this challenge</DialogTitle>
          <DialogDescription>
            You&apos;re staking {formatAmount(stakeAmount)}. Fail, and you owe it
            to a charity of your choosing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="join-charity">If you fail, you donate to…</Label>
          <Input
            id="join-charity"
            placeholder="e.g. Red Cross"
            value={charityName}
            maxLength={80}
            onChange={(e) => setCharityName(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={join} disabled={submitting}>
            {submitting ? "Joining…" : "Join"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
