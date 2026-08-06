"use client";

import Link from "next/link";
import { formatYmd } from "@/lib/dates";
import type { Challenge } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The creator's two switches: whether the habit rolls into another cycle on
 * its own, and whether its streak counts on other people's leaderboards.
 *
 * One card because they share a gate — both are creator-only and both apply
 * only while the habit is running — and because two settings you touch about
 * once in the life of a habit do not each deserve a section on the screen you
 * open every day to check in.
 */
export function ChallengeSettingsCard({
  challenge,
  show,
  nextCycleStart,
  nextCycleWeeks,
  togglingAutoRepeat,
  togglingVisibility,
  onToggleAutoRepeat,
  onToggleVisibility,
}: {
  challenge: Challenge;
  /** Creator, and the habit still active. See challengePermissions. */
  show: boolean;
  nextCycleStart: string;
  nextCycleWeeks: number;
  togglingAutoRepeat: boolean;
  togglingVisibility: boolean;
  onToggleAutoRepeat: (next: boolean) => void;
  onToggleVisibility: (next: "public" | "private") => void;
}) {
  return (
    <>
    {/* One card for the two creator switches, replacing a card each. They
        were "Keep it going" and "Leaderboard": a heading, a paragraph of
        explanation and a control apiece, for two settings you touch about
        once in the life of a habit. Neither earned a section of its own on
        the screen you open every day to check in.

        The switch's own label carries what each one does; the paragraph
        each used to need is gone rather than relocated. What survives is
        the conditional detail — an already-created next cycle that outlives
        its own switch — because that one is genuinely surprising. */}
    {/* canSetAutoRepeat is `isCreator && status === "active"` — the same
        condition the visibility toggle needs, which is why the two settings
        share one card and one gate. */}
    {show && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Switch
            checked={challenge.autoRepeat === true}
            onCheckedChange={onToggleAutoRepeat}
            disabled={togglingAutoRepeat}
            label="Repeat automatically"
            className="w-full"
          >
            <span>
              <span className="block text-sm font-medium">
                Repeat automatically
              </span>
              <span className="block text-xs text-muted-foreground">
                Rolls into another {nextCycleWeeks} week
                {nextCycleWeeks === 1 ? "" : "s"} on {formatYmd(nextCycleStart)}
                , same stake
                {challenge.mode === "group" ? " and members" : ""}
              </span>
            </span>
          </Switch>
          {/* Deliberately not deleted when the switch goes off: it is a real
              challenge people may already have checked into. */}
          {challenge.repeatedToId && !challenge.autoRepeat && (
            <p className="text-xs text-muted-foreground">
              The next cycle was already created and still runs —{" "}
              <Link
                href={`/challenges/${challenge.repeatedToId}`}
                className="underline"
              >
                open it
              </Link>{" "}
              to cancel or delete it.
            </p>
          )}
          {/* Available even after friends have joined — "they joined and now
              I'd rather this wasn't public" is the whole point (see
              setChallengeVisibilityAdmin). */}
          <Switch
            checked={challenge.visibility !== "private"}
            onCheckedChange={(next) =>
              onToggleVisibility(next ? "public" : "private")
            }
            disabled={togglingVisibility}
            label="Count on leaderboards"
            className="w-full"
          >
            <span>
              <span className="block text-sm font-medium">
                Count on leaderboards
              </span>
              <span className="block text-xs text-muted-foreground">
                {challenge.visibility === "private"
                  ? challenge.mode === "group"
                    ? "Private — this streak only counts for people in it"
                    : "Private — this streak only counts for you"
                  : "This streak counts toward your rank for other people"}
              </span>
            </span>
          </Switch>
        </CardContent>
      </Card>
    )}

    </>
  );
}
