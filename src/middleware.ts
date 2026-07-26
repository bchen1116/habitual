import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "session";

/**
 * Presence check only — the Edge runtime can't run the Admin SDK, so real
 * verification happens in server components via getCurrentUser(). This just
 * bounces obviously-signed-out visitors before any page code runs.
 *
 * /join/[code] is deliberately NOT in the matcher below: it's a public
 * share-invite landing page (see src/app/join/[code]/page.tsx), meant to
 * work for a friend who's never signed in — its own signed-out branch
 * renders the challenge preview plus a "Sign in to join" link. Gating it
 * here would bounce that exact visitor to a bare /login with no context
 * before that branch ever got a chance to render.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  // Every route under the (app) layout group — route groups aren't part of
  // the URL, so each top-level segment needs its own entry. Keep this in
  // sync with src/app/(app)/*; falling behind just means that route's
  // signed-out redirect happens a beat later, at the layout's own
  // getCurrentUser() check, rather than at the edge — not a security gap,
  // but worth keeping current for consistency. /join is intentionally
  // excluded — see the comment above.
  matcher: [
    "/dashboard/:path*",
    "/challenges/:path*",
    "/groups/:path*",
    "/ledger/:path*",
    "/settings/:path*",
    "/stats/:path*",
  ],
};
