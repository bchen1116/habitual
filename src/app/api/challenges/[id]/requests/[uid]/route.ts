import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import {
  JoinRequestError,
  respondToJoinRequestAdmin,
} from "@/lib/server/challenge-admin";

const payloadSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "That request no longer exists." },
  "not-owner": { status: 403, message: "Only the creator can respond to requests." },
  started: { status: 409, message: "This challenge has already started." },
  full: { status: 409, message: "This challenge is full." },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; uid: string }> }
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

  const { id, uid } = await params;

  try {
    await respondToJoinRequestAdmin(user.uid, id, uid, parsed.data.action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof JoinRequestError) {
      const mapped = ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't respond to that request.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("respondToJoinRequest failed:", err);
    return NextResponse.json(
      { error: "Couldn't respond to that request." },
      { status: 500 }
    );
  }
}
