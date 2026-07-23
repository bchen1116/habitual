import "server-only";

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

/**
 * Verifies the session cookie and returns the signed-in user, or null.
 * Never throws — a missing/invalid/expired cookie just means signed out.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!session) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
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
      console.error("getCurrentUser failed for a non-auth reason:", err);
    }
    return null;
  }
}
