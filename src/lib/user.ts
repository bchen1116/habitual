"use client";

import type { User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";

/**
 * Creates the Firestore user doc on first sign-in; refreshes profile fields
 * (and timezone) on subsequent sign-ins.
 *
 * Timezone policy (docs/01): refresh only when the user has no active
 * challenges. Challenges don't exist yet in step 1, so this refreshes
 * unconditionally — step 2 must add the active-challenge guard.
 */
export async function ensureUserDoc(user: User): Promise<void> {
  const db = getClientDb();
  const ref = doc(db, "users", user.uid);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const profile = {
    displayName: user.displayName ?? user.email ?? "Anonymous",
    email: user.email ?? "",
    photoURL: user.photoURL ?? null,
    timezone,
  };

  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { ...profile, createdAt: serverTimestamp() });
  } else {
    await setDoc(ref, profile, { merge: true });
  }
}
