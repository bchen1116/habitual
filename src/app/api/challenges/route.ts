import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import {
  createChallengeAdmin,
  yyyymmddUTC,
} from "@/lib/server/challenge-admin";
import { addDaysYmd } from "@/lib/dates";

const payloadSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200),
    mode: z.enum(["solo", "group"]),
    forfeitType: z.enum(["charity", "pool"]),
    maxMembers: z.number().int().min(2).max(100).nullable(),
    frequencyType: z.enum(["daily", "weekly_count"]),
    target: z.number().int().min(1).max(7),
    startDate: z.string().regex(/^\d{8}$/),
    durationDays: z.number().refine((v) => [7, 14, 21, 28].includes(v), {
      message: "Whole-week durations only",
    }),
    skipDays: z.number().int().min(0).max(30),
    stakeAmount: z.number().positive().max(10000),
    charityName: z.string().trim().max(80).nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.forfeitType === "pool" && data.mode !== "group") {
      ctx.addIssue({
        code: "custom",
        path: ["forfeitType"],
        message: "Winner pool is only available for group challenges",
      });
    }
    if (data.forfeitType === "charity" && !data.charityName?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["charityName"],
        message: "Charity mode needs a charity name",
      });
    }
  });

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
      { error: "Invalid challenge", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;

  // "Today or later" with a 1-day UTC tolerance so users in timezones
  // behind UTC can still start "today" (their local date).
  const earliest = yyyymmddUTC(new Date(Date.now() - 24 * 60 * 60 * 1000));
  if (data.startDate < earliest) {
    return NextResponse.json(
      { error: "Start date must be today or later" },
      { status: 400 }
    );
  }

  try {
    const result = await createChallengeAdmin(
      user.uid,
      user.displayName ?? user.email ?? "Anonymous",
      {
        name: data.name,
        description: data.description,
        mode: data.mode,
        forfeitType: data.forfeitType,
        maxMembers: data.mode === "group" ? data.maxMembers : null,
        frequencyType: data.frequencyType,
        target: data.target,
        startDate: data.startDate,
        endDate: addDaysYmd(data.startDate, data.durationDays - 1),
        skipDays: data.skipDays,
        stakeAmount: data.stakeAmount,
        charityName:
          data.forfeitType === "charity" ? data.charityName!.trim() : null,
      }
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("createChallenge failed:", err);
    return NextResponse.json(
      { error: "Couldn't create the challenge" },
      { status: 500 }
    );
  }
}
