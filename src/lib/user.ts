"use client";

import type { User } from "firebase/auth";
import {
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { activeChallengesQuery } from "@/lib/challenges";
import { browserTimezone } from "@/lib/dates";

/**
 * Creates the Firestore user doc on first sign-in; refreshes profile fields
 * on subsequent sign-ins.
 *
 * Timezone policy (docs/01): refresh only when the user has NO active
 * challenges — freezing it mid-challenge keeps day boundaries stable.
 */
export async function ensureUserDoc(user: User): Promise<void> {
  const db = getClientDb();
  const ref = doc(db, "users", user.uid);
  const timezone = browserTimezone();

  const profile: Record<string, unknown> = {
    displayName: user.displayName ?? user.email ?? "Anonymous",
    email: user.email ?? "",
    photoURL: user.photoURL ?? null,
  };

  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { ...profile, timezone, createdAt: serverTimestamp() });
    return;
  }

  const hasActiveChallenge = !(
    await getDocs(query(activeChallengesQuery(db, user.uid), limit(1)))
  ).empty;
  if (!hasActiveChallenge) {
    profile.timezone = timezone;
  }
  await setDoc(ref, profile, { merge: true });
}
