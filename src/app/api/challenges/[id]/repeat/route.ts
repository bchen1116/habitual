import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { RepeatChallengeError, repeatChallengeAdmin } from "@/lib/server/challenge-admin";

const repeatPayloadSchema = z.object({
  stakeAmount: z.number().positive().max(10000),
  skipDays: z.number().int().min(0).max(30),
});

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Challenge not found." },
  "not-owner": { status: 403, message: "Only the creator can repeat this habit." },
  "not-ended": { status: 400, message: "This habit hasn't ended yet." },
  "invalid-stake": { status: 400, message: "Stake must be between $0 and $10,000." },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const parsed = repeatPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid repeat request" }, { status: 400 });
  }

  const { id } = await params;

  try {
    const result = await repeatChallengeAdmin(user.uid, id, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RepeatChallengeError) {
      const mapped = ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't repeat this habit.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("repeatChallenge failed:", err);
    return NextResponse.json({ error: "Couldn't repeat this habit." }, { status: 500 });
  }
}
