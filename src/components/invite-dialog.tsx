"use client";

import { ShareLink } from "@/components/share-link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * The join code and share link, behind a button instead of in front of one.
 *
 * This was a permanent card near the top of every group habit, and it earned
 * that space exactly twice: the day the habit was created, and any day someone
 * decided to add a friend. Every other visit it pushed the thing you came for
 * — today's progress — further down the screen to show a code you'd already
 * shared. Inviting is a deliberate act, so it gets a deliberate control.
 *
 * The trigger stays a labelled button in the header rather than hiding under a
 * menu, so the feature is still visible at a glance; it's the *code* that
 * moves behind a tap, not the idea that you can invite people.
 */
export function InviteDialog({
  joinCode,
  name,
  joinClosed,
  isCreator,
  toggling,
  onToggleJoinClosed,
}: {
  joinCode: string;
  name: string;
  joinClosed: boolean;
  isCreator: boolean;
  toggling: boolean;
  onToggleJoinClosed: (closed: boolean) => void;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite friends</DialogTitle>
          <DialogDescription>
            {joinClosed
              ? "Joining is closed — reopen it to let more people in."
              : "Share this link — joining stays open until you close it."}
          </DialogDescription>
        </DialogHeader>
        {!joinClosed && (
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-full bg-ink px-4 py-1.5 font-mono text-sm font-bold tracking-widest text-primary">
              {joinCode}
            </code>
            <ShareLink joinCode={joinCode} name={name} />
          </div>
        )}
        {isCreator && (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => onToggleJoinClosed(!joinClosed)}
            disabled={toggling}
          >
            {toggling ? "Updating…" : joinClosed ? "Reopen joining" : "Close joining"}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
