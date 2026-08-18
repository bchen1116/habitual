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
  selfAway,
  selfSteppedOut = false,
}: {
  challenge: Challenge;
  members: ({ uid: string } & ChallengeMember)[];
  allCheckins: { uid: string; localDate: string }[];
  today: string;
  selfUid: string;
  /**
   * The viewer's own excused days in this cycle, and whether they add up to
   * sitting it out. Only their own: time off is declared on users/{uid},
   * which firestore.rules makes owner-only, so a client genuinely cannot see
   * anyone else's. What it CAN see is `excluded` on each member doc, which is
   * why the creator's excusal shows for everyone and a member's own booking
   * shows only to them.
   */
  selfAway?: ReadonlySet<string>;
  selfSteppedOut?: boolean;
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
    // Days the viewer declared off shrink what this cycle asks of them, on
    // both sides of the sum — otherwise their row here shows "2 of 7" while
    // the progress card directly above it says five of those days aren't
    // being asked for. Only their own row can do this; see selfAway.
    const away = m.uid === selfUid ? selfAway : undefined;
    const used = skipsUsed(challenge, ymds, today, m.joinedDate, away);
    return {
      ...m,
      completed: m.outcome !== null ? m.completedCount : ymds.length,
      total: totalRequired(challenge, m.joinedDate, away),
      onTrack: used <= challenge.skipDays,
      // Out of this cycle entirely: excused by the creator, or booked past
      // this habit's time-off budget and sitting it out. Both are true from
      // the moment they happen, not from grading — a row that keeps counting
      // days until the nightly job runs is telling someone their attendance
      // still matters when it has already stopped mattering.
      outOfCycle:
        m.excluded === true ||
        m.outcome === "excluded" ||
        m.outcome === "stepped-out" ||
        (m.uid === selfUid && selfSteppedOut),
      // Whether this row has anything to offer beyond the profile link — the
      // same three conditions the server enforces on both actions.
      manageable: isCreator && m.uid !== selfUid && state === "active",
    };
  });
  // Someone sitting the cycle out isn't off track, and isn't on it either —
  // counting them either way would misdescribe the group.
  const graded = rows.filter((r) => !r.outOfCycle);
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
            {/* One word for one state. "Excused" and "Away" described the
                same situation — nothing asked, no stake either way — and
                differed only in how someone arrived at it, which is what the
                tooltip is for. Two labels for one state invites the reader to
                look for a difference that isn't there. */}
            {row.outOfCycle && row.outcome !== "succeeded" &&
              row.outcome !== "failed" && (
              <span
                className="text-xs text-muted-foreground"
                title={
                  row.excluded || row.outcome === "excluded"
                    ? "Excused from this cycle by the creator — nothing due, no stake either way"
                    : "Booked enough of this cycle off to sit it out — nothing due, no stake either way"
                }
              >
                Excused
              </span>
            )}
            {row.outcome === null && !row.outOfCycle && (
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
