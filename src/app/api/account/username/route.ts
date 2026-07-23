import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { UsernameError, claimUsernameAdmin } from "@/lib/server/username-admin";

const payloadSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{3,20}$/, "3-20 characters: letters, numbers, underscores"),
});

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "invalid-format": {
    status: 400,
    message: "3-20 characters: letters, numbers, and underscores only.",
  },
  taken: { status: 409, message: "That username is already taken." },
};

export async function POST(request: NextRequest) {
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
    return NextResponse.json(
      { error: "3-20 characters: letters, numbers, and underscores only." },
      { status: 400 }
    );
  }

  try {
    await claimUsernameAdmin(user.uid, parsed.data.username);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UsernameError) {
      const mapped = ERROR_RESPONSES[err.code] ?? {
        status: 500,
        message: "Couldn't save that username.",
      };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("claimUsername failed:", err);
    return NextResponse.json(
      { error: "Couldn't save that username." },
      { status: 500 }
    );
  }
}
