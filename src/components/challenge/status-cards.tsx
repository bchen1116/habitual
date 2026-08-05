"use client";

import Link from "next/link";
import { daysBetweenInclusive, formatYmd } from "@/lib/dates";
import { formatAmount } from "@/lib/currency";
import type { ChallengeState } from "@/lib/progress";
import type { Challenge, ChallengeMember } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Where a habit stands, when that is the headline rather than a detail:
 * graded and won, graded and lost, cancelled, or not started yet.
 *
 * Four mutually exclusive states in one component because they are one
 * decision — exactly one of them can be true, and reading them together is
 * the only way to see that the set is complete. An active habit renders
 * nothing here; its status lives in the progress card instead.
 */
export function ChallengeStatusCards({
  challenge,
  state,
  member,
  canCancel,
  cancelling,
  onCancel,
  today,
}: {
  challenge: Challenge;
  state: ChallengeState;
  member: ChallengeMember | null;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
  today: string;
}) {
  return (
    <>
    {state === "adjudicated" && member?.outcome === "succeeded" && (
      <Card className="border-primary">
        <CardHeader>
          <CardTitle>You did it! 🎉</CardTitle>
          <CardDescription>
            {member.completedCount} check-ins, {member.skipsUsed} of{" "}
            {challenge.skipDays} skips used.{" "}
            {challenge.forfeitType === "pool"
              ? "Your stake stays yours — and any forfeited stakes appear in your ledger."
              : `Your ${formatAmount(challenge.stakeAmount)} stays yours.`}
          </CardDescription>
        </CardHeader>
        {challenge.forfeitType === "pool" && (
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/ledger?tab=owed">View in ledger</Link>
            </Button>
          </CardContent>
        )}
      </Card>
    )}

    {state === "adjudicated" && member?.outcome === "failed" && (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle>You missed too many days</CardTitle>
          <CardDescription>
            {challenge.forfeitType === "pool"
              ? `You owe ${formatAmount(challenge.stakeAmount)}, split among the members who succeeded. (If nobody succeeded, no one owes anything.)`
              : `You owe ${formatAmount(challenge.stakeAmount)} to ${member.charityName ?? "your charity"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/ledger">View in ledger</Link>
          </Button>
        </CardContent>
      </Card>
    )}

    {state === "cancelled" && (
      <Card>
        <CardHeader>
          <CardTitle>Cancelled</CardTitle>
          <CardDescription>
            This challenge was cancelled before it started. No stakes apply.
          </CardDescription>
        </CardHeader>
      </Card>
    )}

    {state === "upcoming" && (
      <Card>
        <CardHeader>
          <CardTitle>
            Starts in {daysBetweenInclusive(today, challenge.startDate) - 1} day
            {daysBetweenInclusive(today, challenge.startDate) - 1 === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            {formatYmd(challenge.startDate)} – {formatYmd(challenge.endDate)}
          </CardDescription>
        </CardHeader>
        {canCancel && (
          <CardContent>
            <Button
              variant="destructive"
              onClick={onCancel}
              disabled={cancelling}
            >
              {cancelling ? "Cancelling…" : "Cancel challenge"}
            </Button>
          </CardContent>
        )}
      </Card>
    )}

    </>
  );
}
