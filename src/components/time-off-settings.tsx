"use client";

import { useState } from "react";
import { addDaysYmd, daysBetweenInclusive, formatYmd, todayYmd } from "@/lib/dates";
import { DateRangeCalendar } from "@/components/ui/date-range-calendar";
import { useActivity } from "@/components/activity-provider";
import {
  TimeOffImpact,
  TimeOffImpactSummary,
} from "@/components/time-off-impact";
import { groupImpacts, habitImpacts } from "@/lib/time-off-impact";
import { useUserSettings } from "@/hooks/use-user-settings";
import { addAwayRange, removeAwayRange } from "@/lib/away-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Booking time off.
 *
 * One list for every habit, because a holiday is one fact about you rather
 * than one per habit — the alternative was re-entering the same fortnight on
 * each one, which is a chore people half-do, and a half-booked holiday is
 * worse than none.
 *
 * One calendar rather than two date fields, which on a phone meant two
 * full-screen OS pickers to express a single idea. The rules are left to the
 * preview underneath instead of being explained up front: what actually
 * matters is what happens to *your* habits, and that's a list, not a policy.
 */
export function TimeOffSettings({ uid }: { uid: string }) {
  const { timezone, awayRanges } = useUserSettings(uid);
  const { challenges, joinedDateByChallenge, checkinYmdsByChallenge } =
    useActivity();
  const today = todayYmd(timezone);
  // Tomorrow, in the user's own timezone: the earliest the server will accept,
  // so the picker can't offer a date that would come back as an error.
  const earliest = addDaysYmd(today, 1);

  const [range, setRange] = useState({ start: "", end: "" });
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which booked range is mid-confirmation, by start date. */
  const [confirming, setConfirming] = useState<string | null>(null);

  async function handleAdd() {
    setBusy(true);
    setError(null);
    try {
      await addAwayRange(range.start, range.end, label.trim() || null);
      setRange({ start: "", end: "" });
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't book that time off.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(rangeStart: string) {
    setBusy(true);
    setError(null);
    try {
      await removeAwayRange(rangeStart);
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that.");
    } finally {
      setBusy(false);
    }
  }

  const { start: startYmd, end: endYmd } = range;
  const valid =
    startYmd.length === 8 &&
    endYmd.length === 8 &&
    endYmd >= startYmd &&
    startYmd >= earliest;

  /**
   * The breakdown for one stretch, against the ranges that would then exist.
   *
   * The parameter is `span`, not `range`: `range` is the state holding the
   * dates being composed, and a parameter of that name shadowed it. That
   * shadowing hid a real bug — each already-booked row was passed the
   * composed range and so described the wrong dates.
   */
  function impactsFor(span: { start: string; end: string }, extra = false) {
    const ranges = extra ? [...awayRanges, span] : awayRanges;
    return groupImpacts(
      habitImpacts(
        challenges ?? [],
        ranges,
        span,
        joinedDateByChallenge,
        checkinYmdsByChallenge,
        timezone
      )
    );
  }

  // Named before you commit rather than discovered on the habit page
  // afterwards — which is the whole reason this control lives inside the app
  // shell, where the habit list is already in hand.
  const preview = valid
    ? impactsFor({ start: startYmd, end: endYmd }, true)
    : [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Days you book off aren&apos;t counted by any habit. Book them before
        they start.
      </p>

      {awayRanges.length > 0 && (
        <ul className="flex flex-col gap-2">
          {awayRanges.map((booked) => {
            const started = booked.start <= today;
            const days = daysBetweenInclusive(booked.start, booked.end);
            const impacts = impactsFor(booked);
            return (
              <li
                key={booked.start}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  {formatYmd(booked.start)} – {formatYmd(booked.end)}
                  <span className="text-muted-foreground">
                    {" "}
                    · {days} day{days === 1 ? "" : "s"}
                  </span>
                  {booked.label && (
                    <span className="text-muted-foreground"> · {booked.label}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {started && (
                    <span className="text-xs text-muted-foreground">
                      {booked.end < today ? "Past" : "In progress"}
                    </span>
                  )}
                  {/* Removable whether or not it has started. Deleting time
                      off is the self-harming direction — it hands days back
                      to the habit — so the only thing standing between you
                      and it is knowing what it costs. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      started
                        ? setConfirming(
                            confirming === booked.start ? null : booked.start
                          )
                        : handleRemove(booked.start)
                    }
                  >
                    Remove
                  </Button>
                </span>
                </div>
                {confirming === booked.start && (
                  <div className="mt-2 rounded-xl border-2 border-input p-3">
                    <p className="text-sm">
                      These days go back to counting. Anything you didn&apos;t
                      check in becomes a miss.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleRemove(booked.start)}
                      >
                        {busy ? "Removing…" : "Remove it anyway"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirming(null)}
                      >
                        Keep it
                      </Button>
                    </div>
                  </div>
                )}
                {/* Recomputed rather than stored, because which cycles a
                    stretch covers changes as habits are created, repeated and
                    joined — but summarised, not spelled out. The full version
                    is on the preview, where there's a decision to make. */}
                <TimeOffImpactSummary groups={impacts} />
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <DateRangeCalendar
          start={startYmd}
          end={endYmd}
          min={earliest}
          onChange={setRange}
        />
        <Input
          placeholder="What for? (optional)"
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
        />
        {valid && (
          <div className="flex flex-col gap-2 rounded-xl border-2 border-input p-3">
            <p className="text-xs font-medium">
              {formatYmd(startYmd)} – {formatYmd(endYmd)}, habit by habit
            </p>
            <TimeOffImpact
              groups={preview}
              untouched={
                (challenges ?? []).filter(
                  (c) =>
                    c.status === "active" &&
                    !preview.some((g) => g.challengeId === c.id)
                ).length
              }
            />
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Earliest: {formatYmd(earliest)}
          </span>
          <Button disabled={!valid || busy} onClick={handleAdd}>
            {busy ? "Saving…" : "Book time off"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
