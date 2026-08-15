"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface MemberActionTarget {
  uid: string;
  displayName: string;
  username?: string | null;
  /** Currently excused from this cycle by the creator. */
  excluded?: boolean;
}

/**
 * What you can do about one member, on one screen.
 *
 * This replaces two buttons that sat inline in the member row. They fit on a
 * desktop and did not fit on a phone: the row is `flex` with the name as the
 * only flexible child, so "Excuse" and "Remove" — each a pill of condensed
 * uppercase — took their width first and the name truncated into nothing.
 * The controls for acting on a person had squeezed out the one thing telling
 * you which person you were acting on.
 *
 * A sheet fixes that by removing the competition rather than shrinking it:
 * the row goes back to name-and-progress, and the actions get a surface where
 * each can say what it does. That second part is worth as much as the space.
 * "Excuse" and "Remove" are a week and a permanence apart, they move real
 * money in different directions, and as bare four-letter pills side by side
 * nothing distinguished them but the word.
 */
export function MemberActionsDialog({
  member,
  canManage,
  busy,
  onOpenChange,
  onSetExclusion,
  onRemove,
}: {
  /** Null closes the sheet. Held by the parent so one dialog serves every row. */
  member: MemberActionTarget | null;
  /** Creator, someone else's row, cycle still live. */
  canManage: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSetExclusion: (uid: string, excluded: boolean) => Promise<void>;
  onRemove: (uid: string) => Promise<void>;
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Reset per member, not on close: leaving it set would open the *next*
  // person's sheet already showing "Remove them anyway".
  useEffect(() => {
    setConfirmingRemove(false);
  }, [member?.uid]);

  if (!member) return null;
  // A const copy, so the narrowing above survives into the callbacks below —
  // a parameter binding's doesn't.
  const target = member;

  // Closed on success so the result is visible immediately — the row behind
  // this updates from the members listener. On failure the page's error line
  // is behind the sheet, so closing is what surfaces it either way.
  async function run(action: Promise<void>) {
    await action;
    onOpenChange(false);
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="truncate">{target.displayName}</DialogTitle>
          {target.username && (
            <DialogDescription>@{target.username}</DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Button asChild variant="outline" className="w-full">
            <Link href={`/u/${target.uid}`}>View profile</Link>
          </Button>

          {canManage && (
            <div className="flex flex-col gap-1">
              <Button
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() =>
                  run(onSetExclusion(target.uid, !target.excluded))
                }
              >
                {target.excluded ? "Include this cycle" : "Excuse this cycle"}
              </Button>
              <p className="px-1 text-xs text-muted-foreground">
                {target.excluded
                  ? "Puts them and their stake back in for the rest of this cycle."
                  : "Nothing asked of them for the rest of this cycle, and no stake either way. Just this cycle."}
              </p>
            </div>
          )}

          {canManage && !confirmingRemove && (
            <Button
              variant="ghost"
              className="w-full text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => setConfirmingRemove(true)}
            >
              Remove from habit
            </Button>
          )}

          {/* Two-step rather than window.confirm, matching the booked time-off
              list: a native confirm can't say what the second sentence says,
              and the fact that removal keeps going after this cycle is the
              part someone reaching for "they're away this week" needs to read
              before they tap it. */}
          {canManage && confirmingRemove && (
            <div className="rounded-xl border-2 border-input p-3">
              <p className="text-sm">
                They&apos;re out of this cycle and every repeat after it. Their
                check-ins so far stay on record.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => run(onRemove(target.uid))}
                >
                  {busy ? "Removing…" : "Remove them"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmingRemove(false)}
                >
                  Keep them
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
