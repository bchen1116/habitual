import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVerifiedUser } from "@/lib/session";
import {
  AwayError,
  MAX_AWAY_LABEL_LENGTH,
  MAX_AWAY_RANGES,
  MAX_AWAY_RANGE_DAYS,
  addAwayRangeAdmin,
  removeAwayRangeAdmin,
} from "@/lib/server/away-admin";

const ymd = z.string().regex(/^\d{8}$/);

const addSchema = z.object({
  start: ymd,
  end: ymd,
  label: z.string().max(MAX_AWAY_LABEL_LENGTH).nullish(),
});

const removeSchema = z.object({ start: ymd });

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-in-advance": {
    status: 400,
    message: "Time off has to be booked before it starts — pick a future date.",
  },
  backwards: { status: 400, message: "That range ends before it begins." },
  "too-long": {
    status: 400,
    message: `One stretch can't be longer than ${MAX_AWAY_RANGE_DAYS} days.`,
  },
  "too-many": {
    status: 400,
    message: `You can have ${MAX_AWAY_RANGES} stretches booked at once.`,
  },
  overlaps: {
    status: 400,
    message: "That overlaps time off you've already booked.",
  },
  "already-started": {
    status: 400,
    message: "This one has already started, so it's fixed now.",
  },
  "not-found": { status: 404, message: "No time off booked for that date." },
};

function fail(err: unknown, fallback: string) {
  if (err instanceof AwayError) {
    const mapped = ERROR_RESPONSES[err.code] ?? { status: 500, message: fallback };
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
  console.error("away range change failed:", err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function POST(request: NextRequest) {
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

  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const ranges = await addAwayRangeAdmin(
      user.uid,
      parsed.data.start,
      parsed.data.end,
      parsed.data.label ?? null
    );
    return NextResponse.json({ ranges });
  } catch (err) {
    return fail(err, "Couldn't book that time off.");
  }
}

export async function DELETE(request: NextRequest) {
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

  const parsed = removeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const ranges = await removeAwayRangeAdmin(user.uid, parsed.data.start);
    return NextResponse.json({ ranges });
  } catch (err) {
    return fail(err, "Couldn't remove that time off.");
  }
}
