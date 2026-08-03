"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import type { LeaderboardVisibility } from "@/lib/types";

const OPTIONS: { value: LeaderboardVisibility; label: string }[] = [
  { value: "friends", label: "People I share habits with" },
  { value: "hidden", label: "No one" },
];

/**
 * Account-level control over whether you appear on other people's
 * leaderboards, complementing the per-habit `visibility` flag: that one hides
 * a single habit's streak, this one keeps you off the board entirely.
 *
 * It's stored on users/{uid} and written straight from the client — the same
 * merge-setDoc path displayName and venmoUsername use, allowed by
 * firestore.rules' users update rule (everything except `username`). No API
 * route needed, since there's nothing to validate against other documents.
 *
 * Hiding is strictly outward-facing: you always still see yourself, and you
 * still see everyone else. Missing value means "friends", so nobody's
 * exposure changes when this ships.
 */
export function LeaderboardPrivacy({ uid }: { uid: string }) {
  const [value, setValue] = useState<LeaderboardVisibility | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(getClientDb(), "users", uid),
      (snap) => {
        setValue(
          (snap.data()?.leaderboardVisibility as LeaderboardVisibility | undefined) ??
            "friends"
        );
        setLoadError(false);
      },
      (err) => {
        console.error("leaderboard privacy listener failed:", err);
        setLoadError(true);
      }
    );
    return unsubscribe;
  }, [uid]);

  async function choose(next: LeaderboardVisibility) {
    if (next === value) return;
    setSaving(true);
    setMessage(null);
    try {
      await setDoc(
        doc(getClientDb(), "users", uid),
        { leaderboardVisibility: next },
        { merge: true }
      );
      setMessage(
        next === "hidden"
          ? "Hidden — you won't appear on anyone else's leaderboard."
          : "Visible to people you share habits with."
      );
    } catch {
      setMessage("Couldn't save that. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load this setting. Check your connection and try
        refreshing the page.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={value === option.value ? "default" : "outline"}
            disabled={value === null || saving}
            onClick={() => choose(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {value === "hidden"
          ? "You're off other people's leaderboards. You can still see yours."
          : "Only people you've shared a habit with can see you ranked. Habits you mark private stay out of this either way."}
      </p>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
