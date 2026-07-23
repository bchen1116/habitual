import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import {
  DeleteChallengeError,
  deleteChallengeAdmin,
} from "@/lib/server/challenge-admin";

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Challenge not found." },
  "not-owner": { status: 403, message: "Only the creator can delete this challenge." },
  "not-solo": { status: 400, message: "Only solo challenges can be deleted this way." },
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
      const mapped = ERROR_RESPONSES[err.code] ?? {
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
