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
    maxMembers: z
      .string()
      .refine(
        (v) => v === "" || (/^\d+$/.test(v) && Number(v) >= 2 && Number(v) <= 100),
        "Between 2 and 100 (or leave empty for no cap)"
      ),
    frequencyType: z.enum(["daily", "weekly_count"]),
    target: z.string().regex(/^[1-7]$/, "Between 1 and 7 per week"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    durationDays: z.enum(["7", "14", "21", "28"]),
    skipDays: z
      .string()
      .regex(/^\d{1,2}$/, "A number of skips (0–30)")
      .refine((v) => Number(v) <= 30, "At most 30 skips"),
    stakeAmount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, "A dollar amount, e.g. 10 or 9.99")
      .refine((v) => Number(v) > 0, "Stake something — that's the point")
      .refine((v) => Number(v) <= 10000, "Keep it under $10,000"),
    charityName: z.string().trim().min(1, "Name your charity").max(80),
  })
  .superRefine((data, ctx) => {
    if (dateInputToYmd(data.startDate) < todayYmd(browserTimezone())) {
      ctx.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "Start today or later",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

const STEPS = ["Basics", "Mode", "Schedule", "Stakes", "Review"] as const;

const STEP_FIELDS: (keyof FormValues)[][] = [
  ["name", "description"],
  ["mode", "maxMembers"],
  ["frequencyType", "target", "startDate", "durationDays"],
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
      maxMembers: "",
      frequencyType: "daily",
      target: "5",
      startDate: ymdToDateInput(todayYmd(browserTimezone())),
      durationDays: "7",
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
      const id = await createChallenge({
        name: data.name.trim(),
        description: data.description.trim(),
        mode: data.mode,
        maxMembers:
          data.mode === "group" && data.maxMembers !== ""
            ? Number(data.maxMembers)
            : null,
        frequencyType: data.frequencyType,
        target: Number(data.target),
        startDate: dateInputToYmd(data.startDate),
        durationDays: Number(data.durationDays),
        skipDays: Number(data.skipDays),
        stakeAmount: Number(data.stakeAmount),
        charityName: data.charityName.trim(),
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
  const endYmd = addDaysYmd(startYmd, Number(values.durationDays) - 1);

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
                ? "bg-primary text-primary-foreground"
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
                variant={values.mode === "solo" ? "default" : "outline"}
                onClick={() => form.setValue("mode", "solo")}
              >
                Solo
              </Button>
              <Button
                type="button"
                variant={values.mode === "group" ? "default" : "outline"}
                onClick={() => form.setValue("mode", "group")}
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
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Frequency</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={values.frequencyType === "daily" ? "default" : "outline"}
                onClick={() => form.setValue("frequencyType", "daily")}
              >
                Every day
              </Button>
              <Button
                type="button"
                variant={
                  values.frequencyType === "weekly_count" ? "default" : "outline"
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
              min={ymdToDateInput(todayYmd(browserTimezone()))}
              {...form.register("startDate")}
            />
            {errors.startDate && (
              <p className="text-sm text-destructive">{errors.startDate.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Duration</Label>
            <div className="flex flex-wrap gap-2">
              {(["7", "14", "21", "28"] as const).map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant={values.durationDays === d ? "default" : "outline"}
                  onClick={() => form.setValue("durationDays", d)}
                >
                  {Number(d) / 7} week{d === "7" ? "" : "s"}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatYmd(startYmd)} – {formatYmd(endYmd)}
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
                (values.maxMembers !== ""
                  ? ` · up to ${values.maxMembers} members`
                  : " · no member cap")}
            </p>
            <p>
              {values.frequencyType === "daily"
                ? "Every day"
                : `${values.target}× a week`}{" "}
              · {formatYmd(startYmd)} – {formatYmd(endYmd)}
            </p>
            <p>
              {values.skipDays} skip{values.skipDays === "1" ? "" : "s"} allowed
            </p>
            <p>
              ${values.stakeAmount} to {values.charityName} if you fail
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
          <Button type="button" onClick={next}>
            Next
          </Button>
        ) : (
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create challenge"}
          </Button>
        )}
      </div>
    </form>
  );
}
