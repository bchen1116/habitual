import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin";

export const SESSION_COOKIE_NAME = "session";
export const SESSION_EXPIRES_IN_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

async function readSession(checkRevoked: boolean): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!session) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, checkRevoked);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      displayName: (decoded.name as string | undefined) ?? null,
      photoURL: (decoded.picture as string | undefined) ?? null,
    };
  } catch (err) {
    // Expired/revoked/invalid cookies are routine — treat as signed out
    // silently. Anything else (e.g. a malformed service-account key) is a
    // configuration problem that should be visible in server logs.
    const code = (err as { code?: string })?.code ?? "";
    if (!code.startsWith("auth/")) {
      console.error("session verification failed for a non-auth reason:", err);
    }
    return null;
  }
}

/**
 * The signed-in user, for rendering a page.
 *
 * Signature and expiry are checked locally against Google's public keys,
 * which the Admin SDK caches — no network call. It deliberately does *not*
 * check for revocation, and that is the difference between a tab switch that
 * feels instant and one that doesn't: every route in this app is dynamic
 * (they all read cookies), so this runs on every navigation, and a revocation
 * check is a round trip to Google's auth backend before a single byte of the
 * page can be produced.
 *
 * What makes skipping it reasonable here rather than merely faster: this
 * cookie does not gate the data. The client reads Firestore with its own
 * Firebase Auth ID token, and firestore.rules judges that token, not this
 * cookie. Revoking a session invalidates that token's refresh within the
 * hour, so a revoked user gets an empty shell of a page whose every listener
 * fails — they do not get anyone's data. And they cannot change anything,
 * because the routes that write still check (see getVerifiedUser).
 *
 * The worst case this buys is a revoked session rendering page furniture for
 * up to the cookie's remaining life. Use getVerifiedUser anywhere that would
 * be more than an annoyance.
 *
 * Wrapped in React's `cache` so the layout and the page it renders share one
 * verification instead of doing the same JWT check twice on every hard load.
 * The scope is a single request, so two different visitors can never see each
 * other's result — and it is deliberately not applied to getVerifiedUser,
 * whose entire purpose is to ask the server something it cannot answer from
 * memory.
 */
export const getCurrentUser = cache(async function getCurrentUser(): Promise<SessionUser | null> {
  return readSession(false);
});

/**
 * The signed-in user, for anything that writes or exposes something a revoked
 * session must lose immediately: every mutating API route, account deletion,
 * anything that moves money or membership.
 *
 * Pays a network round trip to Firebase to confirm the session hasn't been
 * revoked since it was issued. That cost is fine here — it's per action, not
 * per navigation — and it is the check that makes "sign out everywhere"
 * actually mean something.
 */
export async function getVerifiedUser(): Promise<SessionUser | null> {
  return readSession(true);
}
