import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME, SESSION_EXPIRES_IN_MS } from "@/lib/session";

/**
 * POST: exchange a Firebase ID token (from client sign-in) for an HTTP-only
 * session cookie so server components can authenticate requests.
 */
export async function POST(request: NextRequest) {
  let idToken: string | undefined;
  try {
    const body = await request.json();
    idToken = body?.idToken;
  } catch {
    // fall through to the check below
  }
  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ error: "idToken is required" }, { status: 400 });
  }

  let adminAuth;
  try {
    adminAuth = getAdminAuth();
  } catch (err) {
    console.error("Admin SDK unavailable (check FIREBASE_SERVICE_ACCOUNT_KEY):", err);
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  try {
    // Reject stale ID tokens: only mint a session for a recent sign-in.
    const decoded = await adminAuth.verifyIdToken(idToken);
    const authTimeMs = decoded.auth_time * 1000;
    if (Date.now() - authTimeMs > 5 * 60 * 1000) {
      return NextResponse.json(
        { error: "Recent sign-in required" },
        { status: 401 }
      );
    }

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_EXPIRES_IN_MS,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_EXPIRES_IN_MS / 1000,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid ID token" }, { status: 401 });
  }
}

/** DELETE: sign out — clear the session cookie. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
