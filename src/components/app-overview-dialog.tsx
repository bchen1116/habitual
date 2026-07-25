"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { CircleHelp } from "lucide-react";
import { getClientDb } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * First-login "how this works" overview, auto-opened once per account —
 * users/{uid}.hasSeenOverview, not per-device, so dismissing on one device
 * doesn't leave it popping up on another. Same ad-hoc onSnapshot-read +
 * setDoc(merge:true)-write pattern every other user-doc field in this app
 * already uses (fcmToken/pwaInstalled in push.ts, timezone, etc.) — no
 * shared user-profile hook exists to plug into, none of those do either.
 *
 * The "?" button reopens the same dialog on demand without touching that
 * flag — it's already true by then, and reopening for reference isn't a
 * fresh "first sighting." autoOpenedRef guards against the dialog popping
 * back open on its own if the snapshot fires again (e.g. some unrelated
 * field on the user doc changes) after the user has already closed it once
 * this session but before the dismiss write has round-tripped back down.
 */
export function AppOverviewDialog({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false);
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(getClientDb(), "users", uid), (snap) => {
      if (autoOpenedRef.current) return;
      if (snap.data()?.hasSeenOverview !== true) {
        autoOpenedRef.current = true;
        setOpen(true);
      }
    });
    return unsubscribe;
  }, [uid]);

  function dismiss() {
    setOpen(false);
    void setDoc(doc(getClientDb(), "users", uid), { hasSeenOverview: true }, { merge: true });
  }

  return (
    <>
      <button
        type="button"
        aria-label="How Habitual works"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-40 flex h-9 w-9 items-center justify-center rounded-full border bg-card text-foreground shadow-md transition-opacity hover:opacity-80 md:bottom-6 md:right-6"
      >
        <CircleHelp className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : dismiss())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How Habitual works</DialogTitle>
            <DialogDescription>A quick rundown before you dive in.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-sm text-foreground">
            <p>
              Habitual turns your habits into commitments with real stakes.
              Create a habit alone, or invite friends into a group — pick a
              stake, a check-in schedule, and how many days you&apos;re
              allowed to skip.
            </p>
            <p>
              Miss more than your allowed skips, and your stake goes to your
              charity of choice — or, in a group pool, gets split among
              whoever succeeded.
            </p>
            <p>
              Habitual only tracks who owes what — it doesn&apos;t move any
              money itself. Settling up (paying your charity, paying a
              friend) happens outside the app, on the honor system; you mark
              a debt settled here once you&apos;ve actually paid it.
            </p>
            <p className="font-medium">
              Check-ins only count for today. There&apos;s no going back to
              log a missed day after the fact — if you don&apos;t check in
              before the day ends, it&apos;s marked missed.
            </p>
          </div>

          <Button onClick={dismiss}>Got it</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
