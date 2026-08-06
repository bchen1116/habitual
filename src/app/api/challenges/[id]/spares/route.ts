import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVerifiedUser } from "@/lib/session";
import { SpareError, setSpareAdmin } from "@/lib/server/spares-admin";

/**
 * `count` 0 takes the spare back, which is why this is one endpoint rather
 * than a POST and a DELETE: applying and unapplying are the same decision at
 * two values, and a DELETE would have needed the week in a query string to say
 * which one it meant.
 */
const payloadSchema = z.object({
  windowStart: z.string().regex(/^\d{8}$/),
  count: z.number().int().min(0).max(7),
});

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Habit not found." },
  "not-member": { status: 403, message: "You're not in this habit." },
  "not-active": {
    status: 400,
    message: "This habit has already been graded — spares are settled.",
  },
  "no-spares-here": {
    status: 400,
    message: "This habit doesn't earn spare skips.",
  },
  "unknown-week": { status: 400, message: "That week isn't part of this habit." },
  "week-not-missed": {
    status: 400,
    message: "That week isn't over yet, or nothing was missed in it.",
  },
  "too-many-for-week": {
    status: 400,
    message: "That's more spares than that week was short by.",
  },
  "insufficient-balance": {
    status: 400,
    message: "You don't have that many spares banked for this habit.",
  },
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
    await setSpareAdmin(
      user.uid,
      id,
      parsed.data.windowStart,
      parsed.data.count
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SpareError) {
      const mapped = ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't update that spare.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("setSpare failed:", err);
    return NextResponse.json(
      { error: "Couldn't update that spare." },
      { status: 500 }
    );
  }
}
