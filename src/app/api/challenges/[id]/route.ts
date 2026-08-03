import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import {
  DeleteChallengeError,
  EditChallengeError,
  deleteChallengeAdmin,
  editChallengeAdmin,
} from "@/lib/server/challenge-admin";

const DELETE_ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Challenge not found." },
  "not-owner": { status: 403, message: "Only the creator can delete this challenge." },
  "already-joined": {
    status: 400,
    message: "Can't delete once other members have joined — try cancelling instead.",
  },
};

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteChallengeAdmin(user.uid, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DeleteChallengeError) {
      const mapped = DELETE_ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't delete the challenge.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("deleteChallenge failed:", err);
    return NextResponse.json(
      { error: "Couldn't delete the challenge." },
      { status: 500 }
    );
  }
}

const editPayloadSchema = z.object({
  stakeAmount: z.number().positive().max(10000),
  endDate: z.string().regex(/^\d{8}$/),
  skipDays: z.number().int().min(0).max(30),
});

const PATCH_ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Challenge not found." },
  "not-owner": { status: 403, message: "Only the creator can edit this challenge." },
  ended: { status: 400, message: "This challenge has already ended." },
  "already-joined": {
    status: 400,
    message: "Can't edit once other members have joined.",
  },
  "invalid-duration": {
    status: 400,
    message: "Duration must be a whole number of weeks, ending today or later.",
  },
  "invalid-stake": { status: 400, message: "Stake must be between $0 and $10,000." },
  "has-next-cycle": {
    status: 400,
    message:
      "The next cycle of this habit already exists, so the end date is fixed. Stake and skips can still be changed.",
  },
};

export async function PATCH(
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

  const parsed = editPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid edit" }, { status: 400 });
  }

  const { id } = await params;

  try {
    const result = await editChallengeAdmin(user.uid, id, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EditChallengeError) {
      const mapped = PATCH_ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't update the challenge.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("editChallenge failed:", err);
    return NextResponse.json(
      { error: "Couldn't update the challenge." },
      { status: 500 }
    );
  }
}
