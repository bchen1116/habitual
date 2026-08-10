"use client";

import { useState } from "react";
import { addDaysYmd, daysBetweenInclusive, formatYmd, todayYmd } from "@/lib/dates";
import { useActivity } from "@/components/activity-provider";
import { TimeOffImpact } from "@/components/time-off-impact";
import { habitImpacts } from "@/lib/time-off-impact";
import { useUserSettings } from "@/hooks/use-user-settings";
import { addAwayRange, removeAwayRange } from "@/lib/away-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** yyyymmdd ⇄ the yyyy-mm-dd a native date input speaks. */
const toInput = (ymd: string) =>
  `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
const fromInput = (value: string) => value.replaceAll("-", "");

/**
 * Booking time off.
 *
 * One list for every habit, because a holiday is one fact about you rather
 * than one per habit — the alternative was re-entering the same fortnight on
 * each one, which is a chore people half-do, and a half-booked holiday is
 * worse than none.
 *
 * The rules people actually run into are stated on the card rather than
 * discovered through an error: it has to be booked before it starts, and a
 * habit covers a third of its own length before you simply sit the cycle out.
 * The first is enforced server-side (lib/server/away-admin.ts) and this is
 * only here so the picker can't offer a date the server would refuse; the
 * second isn't a restriction at all, so it needs no enforcement — but it
 * changes whether a stake is live, so it's named before you commit rather
 * than after.
 */
export function TimeOffSettings({ uid }: { uid: string }) {
  const { timezone, awayRanges } = useUserSettings(uid);
  const { challenges, joinedDateByChallenge, checkinYmdsByChallenge } =
    useActivity();
  const today = todayYmd(timezone);
  // Tomorrow, in the user's own timezone: the earliest the server will accept,
  // so the picker can't offer a date that would come back as an error.
  const earliest = addDaysYmd(today, 1);

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which booked range is mid-confirmation, by start date. */
  const [confirming, setConfirming] = useState<string | null>(null);

  async function handleAdd() {
    setBusy(true);
    setError(null);
    try {
      await addAwayRange(fromInput(start), fromInput(end), label.trim() || null);
      setStart("");
      setEnd("");
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

  const startYmd = start ? fromInput(start) : "";
  const endYmd = end ? fromInput(end) : "";
  const valid =
    startYmd.length === 8 &&
    endYmd.length === 8 &&
    endYmd >= startYmd &&
    startYmd >= earliest;

  /** The breakdown for one stretch, against the ranges that would then exist. */
  function impactsFor(range: { start: string; end: string }, extra = false) {
    const ranges = extra ? [...awayRanges, range] : awayRanges;
    return habitImpacts(
      challenges ?? [],
      ranges,
      range,
      joinedDateByChallenge,
      checkinYmdsByChallenge,
      timezone
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
        Days you book off aren&apos;t counted by any habit — they don&apos;t
        break a streak and they don&apos;t cost you a stake. Book them before
        they start. A habit covers up to a third of its own length; book more
        than that and you simply sit that cycle out, with no result and no
        stake either way.
      </p>

      {awayRanges.length > 0 && (
        <ul className="flex flex-col gap-2">
          {awayRanges.map((range) => {
            const started = range.start <= today;
            const days = daysBetweenInclusive(range.start, range.end);
            const impacts = impactsFor(range);
            return (
              <li
                key={range.start}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  {formatYmd(range.start)} – {formatYmd(range.end)}
                  <span className="text-muted-foreground">
                    {" "}
                    · {days} day{days === 1 ? "" : "s"}
                  </span>
                  {range.label && (
                    <span className="text-muted-foreground"> · {range.label}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {started && (
                    <span className="text-xs text-muted-foreground">
                      {range.end < today ? "Past" : "In progress"}
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
                            confirming === range.start ? null : range.start
                          )
                        : handleRemove(range.start)
                    }
                  >
                    Remove
                  </Button>
                </span>
                </div>
                {confirming === range.start && (
                  <div className="mt-2 rounded-xl border-2 border-input p-3">
                    <p className="text-sm">
                      These days go back to counting. Any you didn&apos;t check
                      in become misses, and any habit you were sitting out{" "}
                      {range.end < today ? "would have wanted" : "will want"}{" "}
                      you back. Nothing that&apos;s already been graded changes.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleRemove(range.start)}
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
                {/* The same breakdown after booking as before it. Which
                    cycles a stretch covers changes as habits are created,
                    repeated and joined, so this is not a one-time
                    confirmation that can be shown once and forgotten. */}
                {impacts.length > 0 && (
                  <div className="mt-2">
                    <TimeOffImpact impacts={impacts} untouched={0} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            From
            <Input
              type="date"
              value={start}
              min={toInput(earliest)}
              onChange={(e) => {
                setStart(e.target.value);
                // A range that ends before it begins is the commonest slip on
                // two separate pickers; following the start date removes it.
                if (!end || fromInput(e.target.value) > fromInput(end)) {
                  setEnd(e.target.value);
                }
              }}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            To
            <Input
              type="date"
              value={end}
              min={start || toInput(earliest)}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
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
              impacts={preview}
              untouched={
                (challenges ?? []).filter(
                  (c) =>
                    c.status === "active" &&
                    !preview.some((i) => i.challenge.id === c.id)
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
