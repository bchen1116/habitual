import { NextRequest, NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/session";
import { RemoveMemberError, removeMemberAdmin } from "@/lib/server/challenge-admin";

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Challenge not found." },
  "not-owner": { status: 403, message: "Only the creator can remove members." },
  "cannot-remove-creator": { status: 400, message: "The creator can't remove themselves." },
  "not-active": { status: 400, message: "This challenge has already ended." },
  "not-member": { status: 404, message: "That person isn't a member of this challenge." },
};

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; uid: string }> }
) {
  const user = await getVerifiedUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id, uid } = await params;

  try {
    await removeMemberAdmin(user.uid, id, uid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RemoveMemberError) {
      const mapped = ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't remove that member.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("removeMember failed:", err);
    return NextResponse.json({ error: "Couldn't remove that member." }, { status: 500 });
  }
}
