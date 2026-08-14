import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVerifiedUser } from "@/lib/session";
import {
  ExcludeMemberError,
  setMemberExclusionAdmin,
} from "@/lib/server/challenge-admin";

const payloadSchema = z.object({ excluded: z.boolean() });

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Habit not found." },
  "not-owner": {
    status: 403,
    message: "Only the creator can excuse someone from a cycle.",
  },
  "not-member": { status: 404, message: "They're not in this habit." },
  "not-active": {
    status: 400,
    message: "This cycle has been graded — its results are settled.",
  },
  "cannot-exclude-self": {
    status: 400,
    message:
      "You can't excuse yourself. Removing your own stake while everyone else's stands isn't an excusal.",
  },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; uid: string }> }
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

  const { id, uid } = await params;

  try {
    await setMemberExclusionAdmin(user.uid, id, uid, parsed.data.excluded);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ExcludeMemberError) {
      const mapped = ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't update that.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("setMemberExclusion failed:", err);
    return NextResponse.json({ error: "Couldn't update that." }, { status: 500 });
  }
}
