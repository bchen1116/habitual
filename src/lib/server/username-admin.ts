import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";

/**
 * Usernames disambiguate same-named people in group settings (member lists,
 * ledger entries). Uniqueness is case-insensitive (a separate `usernames`
 * collection keyed by the lowercased handle acts as the claim lock — the
 * same pattern join codes use), but the user's chosen casing is preserved
 * for display on `users/{uid}.username`.
 */

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export type UsernameErrorCode = "invalid-format" | "taken";

export class UsernameError extends Error {
  constructor(public code: UsernameErrorCode) {
    super(code);
  }
}

export async function claimUsernameAdmin(
  uid: string,
  rawUsername: string
): Promise<void> {
  const username = rawUsername.trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new UsernameError("invalid-format");
  }
  const normalized = username.toLowerCase();

  const db = getAdminDb();
  const usernameRef = db.collection("usernames").doc(normalized);
  const userRef = db.collection("users").doc(uid);

  await db.runTransaction(async (t) => {
    // Reads before writes — Firestore transaction requirement.
    const [usernameSnap, userSnap] = await Promise.all([
      t.get(usernameRef),
      t.get(userRef),
    ]);

    const existingOwner = usernameSnap.exists
      ? (usernameSnap.data()!.uid as string)
      : null;
    if (existingOwner && existingOwner !== uid) {
      throw new UsernameError("taken");
    }

    // Changing usernames: release the old claim so it becomes available again.
    const previous = userSnap.data()?.username as string | undefined;
    const previousNormalized = previous?.toLowerCase();
    if (previousNormalized && previousNormalized !== normalized) {
      t.delete(db.collection("usernames").doc(previousNormalized));
    }

    t.set(usernameRef, { uid });
    t.set(userRef, { username }, { merge: true });
  });
}
