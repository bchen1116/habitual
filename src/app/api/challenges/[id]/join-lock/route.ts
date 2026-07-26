import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { SetJoinClosedError, setJoinClosedAdmin } from "@/lib/server/challenge-admin";

const payloadSchema = z.object({ closed: z.boolean() });

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Challenge not found." },
  "not-owner": { status: 403, message: "Only the creator can change this." },
  "not-group": { status: 400, message: "Solo habits don't have joining to close." },
  "not-active": { status: 400, message: "This challenge has already ended." },
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

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { id } = await params;

  try {
    await setJoinClosedAdmin(user.uid, id, parsed.data.closed);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SetJoinClosedError) {
      const mapped = ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't update joining for this challenge.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("setJoinClosed failed:", err);
    return NextResponse.json(
      { error: "Couldn't update joining for this challenge." },
      { status: 500 }
    );
  }
}
