"use client";

import Link from "next/link";
import { skipsUsed, totalRequired, challengeState } from "@/lib/progress";
import type { Challenge, ChallengeMember } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function MembersCard({
  challenge,
  members,
  allCheckins,
  today,
  selfUid,
  isCreator,
  removingUid,
  onRemove,
  excludingUid,
  onSetExclusion,
}: {
  challenge: Challenge;
  members: ({ uid: string } & ChallengeMember)[];
  allCheckins: { uid: string; localDate: string }[];
  today: string;
  selfUid: string;
  isCreator: boolean;
  removingUid: string | null;
  onRemove: (uid: string) => void;
  /** Which member is mid-request, so only their control disables. */
  excludingUid: string | null;
  onSetExclusion: (uid: string, excluded: boolean) => void;
}) {
  const state = challengeState(challenge, today);

  // Per-member, not shared: a member who joined after the challenge started
  // has a smaller total (and a later skips-used floor) than one who's been
  // in since day one — see effectiveStart in lib/progress.ts.
  const rows = members.map((m) => {
    const ymds = allCheckins
      .filter((c) => c.uid === m.uid)
      .map((c) => c.localDate)
      .filter((d) => d >= challenge.startDate && d <= challenge.endDate);
    const used = skipsUsed(challenge, ymds, today, m.joinedDate);
    return {
      ...m,
      completed: m.outcome !== null ? m.completedCount : ymds.length,
      total: totalRequired(challenge, m.joinedDate),
      onTrack: used <= challenge.skipDays,
    };
  });
  // Someone sitting the cycle out isn't off track, and isn't on it either —
  // counting them either way would misdescribe the group. Same for anyone the
  // creator has excused, whose row says so before grading rather than after.
  const graded = rows.filter(
    (r) => r.outcome !== "stepped-out" && r.outcome !== "excluded" && !r.excluded
  );
  const onTrackCount = graded.filter((r) => r.onTrack).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Members</CardTitle>
        {state === "active" && (
          <CardDescription>
            {onTrackCount} of {graded.length} on track
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.uid} className="flex items-center gap-3">
            <Link
              href={`/u/${row.uid}`}
              className="flex-1 truncate text-sm hover:underline"
            >
              <span className={row.uid === selfUid ? "font-semibold" : ""}>
                {row.displayName}
                {row.uid === selfUid ? " (you)" : ""}
              </span>
              {row.username && (
                <span className="ml-1 text-xs text-muted-foreground">
                  @{row.username}
                </span>
              )}
            </Link>
            {row.outcome === "succeeded" && (
              <span className="text-xs font-bold text-foreground">Succeeded ✓</span>
            )}
            {row.outcome === "failed" && (
              <span className="text-xs font-medium text-destructive">Failed ✗</span>
            )}
            {(row.outcome === "excluded" ||
              (row.excluded && row.outcome === null)) && (
              <span
                className="text-xs text-muted-foreground"
                title="Excused from this cycle by the creator — no stake either way"
              >
                Excused
              </span>
            )}
            {row.outcome === "stepped-out" && (
              <span
                className="text-xs text-muted-foreground"
                title="Booked enough of this cycle off to sit it out — no stake either way"
              >
                Away
              </span>
            )}
            {row.outcome === null && !row.excluded && (
              <>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-foreground"
                    style={{
                      width: `${row.total > 0 ? Math.min(100, (row.completed / row.total) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="w-10 text-right text-xs text-muted-foreground">
                  {row.completed}/{row.total}
                </span>
              </>
            )}
            {/* Excusing sits before Remove deliberately: it's the softer of
                the two and the one more often wanted, and a creator reaching
                for "they're injured this week" should meet it first rather
                than the irreversible one. */}
            {isCreator && row.uid !== selfUid && state === "active" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={excludingUid === row.uid}
                onClick={() => onSetExclusion(row.uid, !row.excluded)}
              >
                {excludingUid === row.uid
                  ? "…"
                  : row.excluded
                    ? "Include"
                    : "Excuse"}
              </Button>
            )}
            {isCreator && row.uid !== selfUid && state === "active" && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={removingUid === row.uid}
                onClick={() => onRemove(row.uid)}
              >
                {removingUid === row.uid ? "Removing…" : "Remove"}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
