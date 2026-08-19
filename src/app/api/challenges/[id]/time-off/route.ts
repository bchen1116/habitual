import { NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/session";
import {
  ChallengeTimeOffError,
  challengeTimeOffAdmin,
} from "@/lib/server/challenge-time-off";

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Challenge not found." },
  "not-member": { status: 403, message: "You're not in this challenge." },
};

/**
 * Which members this cycle isn't asking anything of, and for which days.
 *
 * Server-side because `users/{uid}.awayRanges` is owner-only in the rules —
 * see lib/server/challenge-time-off.ts for the scoping this applies before
 * answering. Display only: adjudication reads the same source itself, so a
 * stale or failed response can never change what anyone owes.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getVerifiedUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  try {
    return NextResponse.json({ members: await challengeTimeOffAdmin(user.uid, id) });
  } catch (err) {
    if (err instanceof ChallengeTimeOffError) {
      const mapped = ERROR_RESPONSES[err.code];
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("challengeTimeOff failed:", err);
    return NextResponse.json(
      { error: "Couldn't load time off." },
      { status: 500 }
    );
  }
}
