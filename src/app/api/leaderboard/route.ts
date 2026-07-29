import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getLeaderboard } from "@/lib/server/leaderboard";

/**
 * Ranking of everyone the signed-in user shares (or has shared) a habit with.
 * Computed server-side because the client physically can't — see the header
 * comment in lib/server/leaderboard.ts. The response carries peers' display
 * fields, which is deliberate and scoped: only for people the viewer actually
 * shares history with, and only the name/handle/avatar the UI renders.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const entries = await getLeaderboard(user.uid);
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("getLeaderboard failed:", err);
    return NextResponse.json(
      { error: "Couldn't load the leaderboard." },
      { status: 500 }
    );
  }
}
