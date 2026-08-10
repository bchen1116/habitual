import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVerifiedUser } from "@/lib/session";
import { formatYmd } from "@/lib/dates";
import {
  AwayError,
  AwaySittingOutError,
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
  "sitting-out": {
    status: 400,
    message: "You're sitting a cycle out on this — it can be removed once that cycle ends.",
  },
  "not-found": { status: 404, message: "No time off booked for that date." },
};

function fail(err: unknown, fallback: string) {
  // Named rather than generic: "you can't delete this" is a dead end, and the
  // habit plus the date it frees up is an answer.
  if (err instanceof AwaySittingOutError) {
    return NextResponse.json(
      {
        // "after <end date>" would be wrong for the day or two a cycle spends
        // ended-but-ungraded, which is exactly when someone is most likely to
        // try this — the result isn't settled yet, so the option is still open
        // and still has to be closed.
        error:
          `You're sitting out "${err.challengeName}" for this, and that's fixed ` +
          `once a cycle has started. It runs to ${formatYmd(err.challengeEndDate)} — ` +
          `you can remove this once that cycle has been graded.`,
      },
      { status: 400 }
    );
  }
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
