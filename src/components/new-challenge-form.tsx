"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createChallenge } from "@/lib/challenges";
import {
  addDaysYmd,
  browserTimezone,
  dateInputToYmd,
  formatYmd,
  todayYmd,
  ymdToDateInput,
} from "@/lib/dates";
import {
  DURATION_PRESETS,
  MAX_DURATION_WEEKS,
  MIN_DURATION_WEEKS,
  isValidDurationWeeks,
  weeksLabel,
} from "@/lib/duration";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// All fields are strings in the form; converted on submit. Whole-week
// durations only (docs/02) — required for weekly_count, harmless for daily.
const formSchema = z
  .object({
    name: z.string().trim().min(1, "Give your challenge a name").max(60),
    description: z.string().trim().max(200),
    mode: z.enum(["solo", "group"]),
    forfeitType: z.enum(["charity", "pool"]),
    joinPolicy: z.enum(["open", "invite"]),
    visibility: z.enum(["public", "private"]),
    maxMembers: z
      .string()
      .refine(
        (v) => v === "" || (/^\d+$/.test(v) && Number(v) >= 2 && Number(v) <= 100),
        "Between 2 and 100 (or leave empty for no cap)"
      ),
    frequencyType: z.enum(["daily", "weekly_count"]),
    target: z.string().regex(/^[1-7]$/, "Between 1 and 7 per week"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    durationWeeks: z
      .string()
      .regex(/^\d{1,2}$/, `A number of weeks (${MIN_DURATION_WEEKS}–${MAX_DURATION_WEEKS})`)
      .refine(
        (v) => Number(v) >= MIN_DURATION_WEEKS && Number(v) <= MAX_DURATION_WEEKS,
        `Between ${MIN_DURATION_WEEKS} and ${MAX_DURATION_WEEKS} weeks`
      ),
    skipDays: z
      .string()
      .regex(/^\d{1,2}$/, "A number of skips (0–30)")
      .refine((v) => Number(v) <= 30, "At most 30 skips"),
    stakeAmount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "A dollar amount, e.g. 10 or 9.99")
      .refine((v) => Number(v) > 0, "Stake something — that's the point")
      .refine((v) => Number(v) <= 10000, "Keep it under $10,000"),
    charityName: z.string().trim().max(80),
  })
  .superRefine((data, ctx) => {
    // Group challenges lock joining once they start (see joinChallengeAdmin),
    // so a same-day start leaves zero window to ever share the invite link —
    // the "Invite friends" card itself only renders while the challenge is
    // still upcoming. Solo has no one to invite, so today is fine there.
    const minStart =
      data.mode === "group"
        ? addDaysYmd(todayYmd(browserTimezone()), 1)
        : todayYmd(browserTimezone());
    if (dateInputToYmd(data.startDate) < minStart) {
      ctx.addIssue({
        code: "custom",
        path: ["startDate"],
        message:
          data.mode === "group"
            ? "Start tomorrow or later — friends need time to join"
            : "Start today or later",
      });
    }
    // Pool mode has no charity; every other combination requires one.
    const effectiveForfeit = data.mode === "solo" ? "charity" : data.forfeitType;
    if (effectiveForfeit === "charity" && data.charityName.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["charityName"],
        message: "Name your charity",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

const STEPS = ["Basics", "Mode", "Schedule", "Stakes", "Review"] as const;

const STEP_FIELDS: (keyof FormValues)[][] = [
  ["name", "description"],
  ["mode", "forfeitType", "joinPolicy", "maxMembers", "visibility"],
  ["frequencyType", "target", "startDate", "durationWeeks"],
  ["skipDays", "stakeAmount", "charityName"],
  [],
];

export function NewChallengeForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onTouched",
    defaultValues: {
      name: "",
      description: "",
      mode: "solo",
      forfeitType: "charity",
      joinPolicy: "open",
      visibility: "public",
      maxMembers: "",
      frequencyType: "daily",
      target: "5",
      startDate: ymdToDateInput(todayYmd(browserTimezone())),
      durationWeeks: "1",
      skipDays: "1",
      stakeAmount: "10",
      charityName: "",
    },
  });

  const values = form.watch();
  const errors = form.formState.errors;

  async function next() {
    const valid = await form.trigger(STEP_FIELDS[step]);
    if (valid) setStep((s) => s + 1);
  }

  /** Group challenges lock joining once they start, so switching to Group
   * pushes a same-day (or already-past-tomorrow) start date forward to
   * tomorrow — otherwise the invite link would never have a real window to
   * be shared before it's already too late to use it. */
  function selectMode(mode: "solo" | "group") {
    form.setValue("mode", mode);
    if (mode === "group") {
      const tomorrow = addDaysYmd(todayYmd(browserTimezone()), 1);
      const current = form.getValues("startDate");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(current) || dateInputToYmd(current) < tomorrow) {
        form.setValue("startDate", ymdToDateInput(tomorrow));
      }
    }
  }

  /** Submit-time validation can fail for fields on earlier steps (e.g. the
   * start date slipping into the past at midnight) — jump to where the
   * error is visible instead of failing silently on the review step. */
  function onInvalid(errs: Record<string, unknown>) {
    const errorFields = Object.keys(errs);
    for (let i = 0; i < STEP_FIELDS.length; i++) {
      if (STEP_FIELDS[i].some((f) => errorFields.includes(f))) {
        setStep(i);
        return;
      }
    }
  }

  async function onSubmit(data: FormValues) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const effectiveForfeit =
        data.mode === "solo" ? "charity" : data.forfeitType;
      const id = await createChallenge({
        name: data.name.trim(),
        description: data.description.trim(),
        mode: data.mode,
        forfeitType: effectiveForfeit,
        joinPolicy: data.mode === "group" ? data.joinPolicy : "open",
        maxMembers:
          data.mode === "group" && data.maxMembers !== ""
            ? Number(data.maxMembers)
            : null,
        frequencyType: data.frequencyType,
        target: Number(data.target),
        startDate: dateInputToYmd(data.startDate),
        durationDays: Number(data.durationWeeks) * 7,
        skipDays: Number(data.skipDays),
        stakeAmount: Number(data.stakeAmount),
        charityName:
          effectiveForfeit === "charity" ? data.charityName.trim() : null,
        visibility: data.visibility,
      });
      router.replace(`/challenges/${id}`);
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Couldn't create the challenge. Please try again."
      );
      setSubmitting(false);
    }
  }

  const startYmd = /^\d{4}-\d{2}-\d{2}$/.test(values.startDate)
    ? dateInputToYmd(values.startDate)
    : todayYmd(browserTimezone());
  // Null while the weeks field is mid-edit (empty, or out of range) — without
  // this, an empty box would render an end date one day *before* the start.
  const durationWeeks = isValidDurationWeeks(Number(values.durationWeeks))
    ? Number(values.durationWeeks)
    : null;
  const endYmd =
    durationWeeks === null ? null : addDaysYmd(startYmd, durationWeeks * 7 - 1);

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit, onInvalid)}
      className="flex flex-col gap-6"
    >
      <ol className="flex items-center gap-2 text-xs text-muted-foreground">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={
              "rounded-full px-2 py-0.5 " +
              (i === step
                ? "bg-foreground text-background"
                : i < step
                  ? "bg-secondary text-secondary-foreground"
                  : "")
            }
          >
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Challenge name</Label>
            <Input
              id="name"
              placeholder="e.g. Stretch every morning"
              {...form.register("name")}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="What counts as done?"
              {...form.register("description")}
            />
            {errors.description && (
              <p className="text-sm text-destructive">
                {errors.description.message}
              </p>
            )}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Mode</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={values.mode === "solo" ? "secondary" : "outline"}
                onClick={() => selectMode("solo")}
              >
                Solo
              </Button>
              <Button
                type="button"
                variant={values.mode === "group" ? "secondary" : "outline"}
                onClick={() => selectMode("group")}
              >
                Group
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {values.mode === "solo"
                ? "Just you versus your habit."
                : "Friends join with an invite link. Everyone stakes their own money and picks their own charity."}
            </p>
          </div>
          {values.mode === "group" && (
            <div className="flex flex-col gap-1.5">
              <Label>Who can join</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={values.joinPolicy === "open" ? "secondary" : "outline"}
                  onClick={() => form.setValue("joinPolicy", "open")}
                >
                  Open
                </Button>
                <Button
                  type="button"
                  variant={values.joinPolicy === "invite" ? "secondary" : "outline"}
                  onClick={() => form.setValue("joinPolicy", "invite")}
                >
                  Invite only
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {values.joinPolicy === "open"
                  ? "Anyone with the link joins immediately."
                  : "Anyone with the link can request to join — you approve each one."}
              </p>
            </div>
          )}
          {values.mode === "group" && (
            <div className="flex flex-col gap-1.5">
              <Label>If someone fails, their stake goes to…</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={values.forfeitType === "charity" ? "secondary" : "outline"}
                  onClick={() => form.setValue("forfeitType", "charity")}
                >
                  Their charity
                </Button>
                <Button
                  type="button"
                  variant={values.forfeitType === "pool" ? "secondary" : "outline"}
                  onClick={() => form.setValue("forfeitType", "pool")}
                >
                  The winners
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {values.forfeitType === "charity"
                  ? "Charity forfeit: each member names a charity they'd owe."
                  : "Winner pool: failed stakes split evenly among members who succeed."}
              </p>
            </div>
          )}
          {values.mode === "group" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="maxMembers">Max members (optional)</Label>
              <Input
                id="maxMembers"
                type="number"
                min={2}
                max={100}
                placeholder="No cap"
                className="w-32"
                {...form.register("maxMembers")}
              />
              {errors.maxMembers && (
                <p className="text-sm text-destructive">
                  {errors.maxMembers.message}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Leaderboard</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={values.visibility === "public" ? "secondary" : "outline"}
                onClick={() => form.setValue("visibility", "public")}
              >
                Counts
              </Button>
              <Button
                type="button"
                variant={values.visibility === "private" ? "secondary" : "outline"}
                onClick={() => form.setValue("visibility", "private")}
              >
                Private
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {values.visibility === "public"
                ? "This habit's streak counts toward your rank on other people's leaderboards."
                : values.mode === "group"
                  ? "Hidden from leaderboards — its streak only shows to people in this habit."
                  : "Hidden from leaderboards — its streak only shows to you."}
            </p>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Frequency</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={values.frequencyType === "daily" ? "secondary" : "outline"}
                onClick={() => form.setValue("frequencyType", "daily")}
              >
                Every day
              </Button>
              <Button
                type="button"
                variant={
                  values.frequencyType === "weekly_count" ? "secondary" : "outline"
                }
                onClick={() => form.setValue("frequencyType", "weekly_count")}
              >
                N times a week
              </Button>
            </div>
          </div>
          {values.frequencyType === "weekly_count" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="target">Times per week</Label>
              <Input
                id="target"
                type="number"
                min={1}
                max={7}
                className="w-24"
                {...form.register("target")}
              />
              {errors.target && (
                <p className="text-sm text-destructive">{errors.target.message}</p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startDate">Start date</Label>
            <Input
              id="startDate"
              type="date"
              className="w-44"
              min={ymdToDateInput(
                values.mode === "group"
                  ? addDaysYmd(todayYmd(browserTimezone()), 1)
                  : todayYmd(browserTimezone())
              )}
              {...form.register("startDate")}
            />
            {values.mode === "group" && (
              <p className="text-xs text-muted-foreground">
                Set at least a day out so friends have time to join before it
                locks.
              </p>
            )}
            {errors.startDate && (
              <p className="text-sm text-destructive">{errors.startDate.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Duration</Label>
            <div className="flex flex-wrap gap-2">
              {DURATION_PRESETS.map((preset) => (
                <Button
                  key={preset.weeks}
                  type="button"
                  variant={durationWeeks === preset.weeks ? "secondary" : "outline"}
                  onClick={() =>
                    form.setValue("durationWeeks", String(preset.weeks), {
                      shouldValidate: true,
                    })
                  }
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Label
                htmlFor="durationWeeks"
                className="font-normal text-xs text-muted-foreground"
              >
                Or set your own
              </Label>
              <Input
                id="durationWeeks"
                type="number"
                min={MIN_DURATION_WEEKS}
                max={MAX_DURATION_WEEKS}
                className="w-20"
                {...form.register("durationWeeks")}
              />
              <span className="text-xs text-muted-foreground">weeks</span>
            </div>
            {errors.durationWeeks ? (
              <p className="text-sm text-destructive">
                {errors.durationWeeks.message}
              </p>
            ) : (
              endYmd && (
                <p className="text-xs text-muted-foreground">
                  {formatYmd(startYmd)} – {formatYmd(endYmd)} ·{" "}
                  {weeksLabel(durationWeeks!)}
                </p>
              )
            )}
            {/* "Can it just never end?" is the obvious question, and the honest
                answer is a product one: the stake is settled at the end date,
                so there has to be one. Repeat is the answer for a habit that
                shouldn't stop — said here rather than leaving people to
                discover it a year later. */}
            <p className="text-xs text-muted-foreground">
              Whole weeks, up to a year — your stake settles on the end date.
              When it finishes you can start the next cycle straight away and
              your streak carries over.
            </p>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skipDays">Allowed skips</Label>
            <Input
              id="skipDays"
              type="number"
              min={0}
              max={30}
              className="w-24"
              {...form.register("skipDays")}
            />
            <p className="text-xs text-muted-foreground">
              Missed check-ins you can absorb before failing.
            </p>
            {errors.skipDays && (
              <p className="text-sm text-destructive">{errors.skipDays.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stakeAmount">Stake (USD)</Label>
            <Input
              id="stakeAmount"
              inputMode="decimal"
              className="w-32"
              {...form.register("stakeAmount")}
            />
            {errors.stakeAmount && (
              <p className="text-sm text-destructive">
                {errors.stakeAmount.message}
              </p>
            )}
          </div>
          {(values.mode === "solo" || values.forfeitType === "charity") && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="charityName">If you fail, you donate to…</Label>
              <Input
                id="charityName"
                placeholder="e.g. Red Cross"
                {...form.register("charityName")}
              />
              {values.mode === "group" && (
                <p className="text-xs text-muted-foreground">
                  This is your charity — each member picks their own when they
                  join.
                </p>
              )}
              {errors.charityName && (
                <p className="text-sm text-destructive">
                  {errors.charityName.message}
                </p>
              )}
            </div>
          )}
          {values.mode === "group" && values.forfeitType === "pool" && (
            <p className="text-xs text-muted-foreground">
              Winner pool: no charity needed — failed stakes go to the members
              who succeed.
            </p>
          )}
        </div>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>{values.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {values.description && (
              <p className="text-muted-foreground">{values.description}</p>
            )}
            <p>
              {values.mode === "solo" ? "Solo" : "Group"}
              {values.mode === "group" &&
                ` · ${values.forfeitType === "pool" ? "winner pool" : "charity forfeit"}`}
              {values.mode === "group" &&
                (values.maxMembers !== ""
                  ? ` · up to ${values.maxMembers} members`
                  : " · no member cap")}
              {values.mode === "group" &&
                (values.joinPolicy === "invite" ? " · invite only" : " · open")}
            </p>
            <p>
              {values.frequencyType === "daily"
                ? "Every day"
                : `${values.target}× a week`}{" "}
              {endYmd && (
                <>
                  · {formatYmd(startYmd)} – {formatYmd(endYmd)} ·{" "}
                  {weeksLabel(durationWeeks!)}
                </>
              )}
            </p>
            <p>
              {values.skipDays} skip{values.skipDays === "1" ? "" : "s"} allowed
            </p>
            <p>
              {values.mode === "group" && values.forfeitType === "pool"
                ? `$${values.stakeAmount} to the winners if you fail`
                : `$${values.stakeAmount} to ${values.charityName} if you fail`}
            </p>
            <p className="text-muted-foreground">
              {values.visibility === "public"
                ? "Counts toward leaderboards"
                : "Private — hidden from leaderboards"}
            </p>
          </CardContent>
        </Card>
      )}

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <div className="flex justify-between">
        {step > 0 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((s) => s - 1)}
            disabled={submitting}
          >
            Back
          </Button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <Button key="next" type="button" onClick={next}>
            Next
          </Button>
        ) : (
          <Button key="submit" type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create challenge"}
          </Button>
        )}
      </div>
    </form>
  );
}
