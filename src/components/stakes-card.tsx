"use client";

import { useState } from "react";
import { formatAmount } from "@/lib/currency";
import { Card, CardContent } from "@/components/ui/card";

/**
 * What's on the line, said once, at the top.
 *
 * This used to be a grey sentence centred at the very bottom of the habit
 * page — "If you fail, you owe $20 to …" — under the history, under the
 * ratings, below everything. It's the reason the app works, and it was
 * footnote-shaped and phrased as a threat you had to scroll to receive.
 *
 * So: the amount is the card, and the consequence is a footnote *about* the
 * amount, behind a help button. That's the right split, because the number is
 * what you check repeatedly and the explanation is what you read once.
 *
 * Disclosure rather than a hover tooltip on purpose. Most of this app's use is
 * on a phone, where there is no hover — a tooltip would be a control that
 * silently does nothing on the majority of visits.
 */
export function StakesCard({
  amount,
  forfeitType,
  charityName,
  /** Shown to members of a habit that will roll into another cycle on its own. */
  autoRepeats = false,
}: {
  amount: number;
  forfeitType: "charity" | "pool";
  charityName: string | null;
  autoRepeats?: boolean;
}) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <div className="flex items-center gap-3">
          <span className="type-display text-3xl leading-none">
            {formatAmount(amount)}
          </span>
          <span className="type-overline text-xs text-muted-foreground">
            at stake
          </span>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            aria-expanded={showHelp}
            aria-label="What happens if I fail?"
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground text-sm font-bold text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            ?
          </button>
        </div>
        {showHelp && (
          <p className="text-sm text-muted-foreground">
            {forfeitType === "pool"
              ? `If you fail, your ${formatAmount(amount)} is split among the members who succeed.`
              : `If you fail, you owe ${formatAmount(amount)} to ${charityName ?? "your charity"}.`}
          </p>
        )}
        {/* Deliberately here and not with the repeat setting: what a member
            needs to know about auto-repeat is that it stakes money again, and
            this is the card about money. Finding that out when the debt
            arrives would be the wrong way to learn it. */}
        {autoRepeats && (
          <p className="text-xs text-muted-foreground">
            Repeats automatically — each new cycle stakes this again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
