"use client";

import Link from "next/link";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { skipsUsed, totalRequired, challengeState } from "@/lib/progress";
import type { Challenge, ChallengeMember } from "@/lib/types";
import { MemberActionsDialog } from "@/components/challenge/member-actions-dialog";
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
  onRemove: (uid: string) => Promise<void>;
  /** Which member is mid-request, so only their control disables. */
  excludingUid: string | null;
  onSetExclusion: (uid: string, excluded: boolean) => Promise<void>;
}) {
  const state = challengeState(challenge, today);
  /** Whose action sheet is open. One dialog serves every row. */
  const [openUid, setOpenUid] = useState<string | null>(null);

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
      // Whether this row has anything to offer beyond the profile link — the
      // same three conditions the server enforces on both actions.
      manageable: isCreator && m.uid !== selfUid && state === "active",
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
        {rows.map((row) => {
          const label = (
            <>
              <span className={row.uid === selfUid ? "font-semibold" : ""}>
                {row.displayName}
                {row.uid === selfUid ? " (you)" : ""}
              </span>
              {row.username && (
                <span className="ml-1 text-xs text-muted-foreground">
                  @{row.username}
                </span>
              )}
            </>
          );
          const status = (
            <>
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
            </>
          );

          // A row with nothing to manage keeps its direct link to the profile:
          // routing every viewer through a sheet whose only entry is "View
          // profile" would be a tap bought for nothing.
          if (!row.manageable) {
            return (
              <div key={row.uid} className="flex min-h-11 items-center gap-3">
                <Link
                  href={`/u/${row.uid}`}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {label}
                </Link>
                {status}
              </div>
            );
          }

          // Where there ARE actions, the whole row opens them rather than the
          // name alone — a name can truncate to six characters, and a tap
          // target that shrinks with the text is the same mistake in a
          // quieter form. min-h-11 on both branches keeps every row at the
          // 44px both platforms ask for, and keeps them the same height as
          // each other. The ⋯ is what says the tap does something new;
          // without it, a tap that used to open a profile would silently
          // change meaning. It sits at the end of the row rather than beside
          // the name because the name truncates with an ellipsis of its own,
          // and two in a row read as one.
          return (
            <button
              key={row.uid}
              type="button"
              onClick={() => setOpenUid(row.uid)}
              aria-label={`Options for ${row.displayName}`}
              className="flex min-h-11 w-full items-center gap-3 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
              {status}
              <MoreHorizontal
                aria-hidden
                className="h-4 w-4 shrink-0 text-muted-foreground"
              />
            </button>
          );
        })}
      </CardContent>

      <MemberActionsDialog
        member={rows.find((r) => r.uid === openUid) ?? null}
        canManage={rows.find((r) => r.uid === openUid)?.manageable ?? false}
        busy={excludingUid === openUid || removingUid === openUid}
        onOpenChange={(open) => !open && setOpenUid(null)}
        onSetExclusion={onSetExclusion}
        onRemove={onRemove}
      />
    </Card>
  );
}
