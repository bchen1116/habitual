import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, SESSION_COOKIE_NAME } from "@/lib/session";
import { deleteAccountAdmin } from "@/lib/server/account-admin";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { confirm?: string } | null = null;
  try {
    body = await request.json();
  } catch {
    // handled below
  }
  if (body?.confirm !== "delete") {
    return NextResponse.json(
      { error: 'Type "delete" to confirm' },
      { status: 400 }
    );
  }

  try {
    await deleteAccountAdmin(user.uid);
  } catch (err) {
    console.error("account deletion failed:", err);
    return NextResponse.json(
      { error: "Couldn't delete your account. Please try again." },
      { status: 500 }
    );
  }

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
