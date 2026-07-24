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
  forfeitType,
  joinPolicy,
}: {
  joinCode: string;
  stakeAmount: number;
  forfeitType: "charity" | "pool";
  joinPolicy: "open" | "invite";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [charityName, setCharityName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function join() {
    if (forfeitType === "charity" && !charityName.trim()) {
      setError("Name the charity you'd owe if you fail.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await joinChallenge(
        joinCode,
        forfeitType === "charity" ? charityName.trim() : null
      );
      if (result.status === "joined") {
        router.replace(`/challenges/${result.challengeId}`);
      } else {
        setSent(true);
        setSubmitting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
      <DialogTrigger asChild>
        <Button size="lg">
          {joinPolicy === "invite" ? "Request to join" : "Join challenge"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle>Request sent</DialogTitle>
              <DialogDescription>
                The creator will need to approve you before you&apos;re in —
                come back to this link to check.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {joinPolicy === "invite" ? "Request to join" : "Join this challenge"}
              </DialogTitle>
              <DialogDescription>
                {forfeitType === "charity"
                  ? `You're staking ${formatAmount(stakeAmount)}. Fail, and you owe it to a charity of your choosing.`
                  : `You're staking ${formatAmount(stakeAmount)}. Fail, and it's split among the members who succeed.`}
                {joinPolicy === "invite" &&
                  " The creator will need to approve your request first."}
              </DialogDescription>
            </DialogHeader>
            {forfeitType === "charity" && (
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
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={join} disabled={submitting}>
                {submitting
                  ? joinPolicy === "invite"
                    ? "Sending…"
                    : "Joining…"
                  : joinPolicy === "invite"
                    ? "Send request"
                    : "Join"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
