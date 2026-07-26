import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { JoinError, joinChallengeAdmin } from "@/lib/server/challenge-admin";

const payloadSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{6}$/, "Join codes are 6 characters"),
  // Required for charity-forfeit challenges; ignored for pool. The server
  // decides based on the challenge's forfeitType.
  charityName: z.string().trim().max(80).nullable(),
});

const JOIN_ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "No open challenge has that code." },
  closed: { status: 409, message: "The creator has closed joining for this challenge." },
  ended: { status: 409, message: "This challenge has already ended." },
  full: { status: 409, message: "This challenge is full." },
  "already-member": { status: 409, message: "You're already in this challenge." },
  "already-requested": {
    status: 409,
    message: "You've already requested to join this challenge.",
  },
  "not-group": { status: 404, message: "No open challenge has that code." },
  "charity-required": {
    status: 400,
    message: "Name the charity you'd owe if you fail.",
  },
};

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const result = await joinChallengeAdmin(
      user.uid,
      user.displayName ?? user.email ?? "Anonymous",
      parsed.data.joinCode,
      parsed.data.charityName
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof JoinError) {
      const mapped = JOIN_ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't join the challenge",
      };
      return NextResponse.json(
        { error: mapped.message, code: err.code },
        { status: mapped.status }
      );
    }
    console.error("joinChallenge failed:", err);
    return NextResponse.json(
      { error: "Couldn't join the challenge" },
      { status: 500 }
    );
  }
}
