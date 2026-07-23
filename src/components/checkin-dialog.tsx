"use client";

import { useState } from "react";
import { checkIn } from "@/lib/challenges";
import type { Challenge } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface CheckinDialogProps {
  challenge: Challenge;
  uid: string;
  today: string; // yyyymmdd in the user's timezone
  onError: (message: string) => void;
}

/**
 * Bottom sheet (mobile) / modal (desktop) confirming today's check-in with
 * an optional note. Optimistic: the write is NOT awaited — the local
 * Firestore cache updates listeners instantly (also the only behavior that
 * works offline, where the promise won't resolve until reconnect). A
 * rules rejection reverts the listener state and surfaces via onError.
 */
export function CheckinDialog({ challenge, uid, today, onError }: CheckinDialogProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  function submit() {
    checkIn(challenge, uid, today, note).catch(() => {
      onError("Check-in failed — it may be past the allowed window. Please try again.");
    });
    setNote("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Check in for today</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{challenge.name}</DialogTitle>
          <DialogDescription>Mark today as done.</DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Add a note (optional)"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Check in</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
