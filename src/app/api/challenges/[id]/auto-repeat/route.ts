import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import {
  SetAutoRepeatError,
  setAutoRepeatAdmin,
} from "@/lib/server/challenge-admin";

const payloadSchema = z.object({ autoRepeat: z.boolean() });

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Challenge not found." },
  "not-owner": { status: 403, message: "Only the creator can change this." },
  "not-active": {
    status: 400,
    message: "This habit has already ended — use Repeat to start a new cycle.",
  },
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
    await setAutoRepeatAdmin(user.uid, id, parsed.data.autoRepeat);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SetAutoRepeatError) {
      const mapped = ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't update auto-repeat.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("setAutoRepeat failed:", err);
    return NextResponse.json(
      { error: "Couldn't update auto-repeat." },
      { status: 500 }
    );
  }
}
