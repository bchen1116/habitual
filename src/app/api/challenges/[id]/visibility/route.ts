import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVerifiedUser } from "@/lib/session";
import {
  SetVisibilityError,
  setChallengeVisibilityAdmin,
} from "@/lib/server/challenge-admin";

const payloadSchema = z.object({ visibility: z.enum(["public", "private"]) });

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Challenge not found." },
  "not-owner": { status: 403, message: "Only the creator can change this." },
  "not-active": { status: 400, message: "This challenge has already ended." },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getVerifiedUser();
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
    await setChallengeVisibilityAdmin(user.uid, id, parsed.data.visibility);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SetVisibilityError) {
      const mapped = ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't update this habit's visibility.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("setChallengeVisibility failed:", err);
    return NextResponse.json(
      { error: "Couldn't update this habit's visibility." },
      { status: 500 }
    );
  }
}
