"use client";

import { useState } from "react";
import { addDaysYmd, formatYmd } from "@/lib/dates";
import { dailyHistory, recentWindow, weeklyWindows } from "@/lib/progress";
import type { PastCycle } from "@/lib/chain-streak";
import type { Challenge, Reflection } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";


/**
 * What was missed: one day, or a whole weekly window.
 *
 * Carried explicitly rather than inferred from the habit's frequency, which
 * is what the label used to do. That inference held only while this list was
 * the sole way to select something — a weekly habit could then only ever
 * select a window. The week strip breaks it: it shows real days for weekly
 * habits too, so "weekly habit ⇒ this date is a window start" stops being
 * true, and a day picked there would be labelled as a week and, worse,
 * logged as one.
 */
export interface MissTarget {
  ymd: string;
  kind: "day" | "window";
}

/**
 * What the miss dialog calls the thing being explained. A window is named by
 * its span rather than its first date, or it would look like the app blamed
 * you for a Monday.
 */
export function missTargetLabel(target: MissTarget | null): string {
  if (!target) return "";
  if (target.kind === "day") return formatYmd(target.ymd, "EEE, MMM d");
  return `${formatYmd(target.ymd)} – ${formatYmd(addDaysYmd(target.ymd, 6))}`;
}

interface HistoryReflectionProps {
  reflectionsByDate: Map<string, Reflection>;
  onSelectMiss: (target: MissTarget) => void;
}

/** windowStart → spares covering it, for the current cycle only. */
type SpareCoverage = ReadonlyMap<string, number>;

/**
 * How much history stays on screen before it has to be asked for. Eight weeks
 * is deliberately above the old 4-week maximum duration, so every habit that
 * could exist before year-long ones were allowed still renders whole.
 */
const COLLAPSED_HISTORY_WEEKS = 8;

/**
 * Whether anything in the History card actually responds to a tap.
 *
 * Only a missed day (or an unmet week) in the *current* cycle does: a done day
 * has nothing to explain, a future one hasn't happened, and an earlier cycle's
 * is `settled` — its reflections live in its own subcollection, so a note
 * tapped there would be filed against the wrong challenge. Which left the
 * card telling everybody to "tap anything you missed" on a screen where, most
 * of the time, nothing was tappable at all.
 *
 * The condition is here rather than duplicated in the two grids so the
 * card's promise and the grids' behaviour can't drift apart — that drift is
 * the bug being fixed, not a hypothetical.
 */
function hasTappableMiss(
  challenge: Challenge,
  checkinYmds: string[],
  today: string,
  joinedDate?: string,
  away?: ReadonlySet<string>
): boolean {
  if (challenge.frequency.type === "daily") {
    return dailyHistory(
      challenge,
      new Set(checkinYmds),
      today,
      joinedDate,
      away
    ).some((e) => e.state === "missed");
  }
  return weeklyWindows(challenge, checkinYmds, today, joinedDate, away).some(
    (w) => w.state === "past-incomplete"
  );
}

function DailyHistoryGrid({
  challenge,
  checkinYmds,
  today,
  memberJoinedDate,
  away,
  pastCycles,
  reflectionsByDate,
  onSelectMiss,
}: {
  challenge: Challenge;
  checkinYmds: string[];
  today: string;
  memberJoinedDate?: string;
  away?: ReadonlySet<string>;
  pastCycles: PastCycle[];
} & HistoryReflectionProps) {
  const [showAll, setShowAll] = useState(false);
  // Earlier cycles first, so a repeated habit reads as one unbroken record
  // rather than starting from nothing every time it rolls over. They're
  // marked settled: their reflections live in their own subcollection, and
  // tapping a day here would file the note against the wrong challenge.
  const all = [
    ...pastCycles.flatMap((c) =>
      dailyHistory(
        c.challenge,
        new Set(c.checkinYmds),
        today,
        c.joinedDate,
        c.away
      ).map((e) => ({ ...e, settled: true }))
    ),
    ...dailyHistory(
      challenge,
      new Set(checkinYmds),
      today,
      memberJoinedDate,
      away
    ).map((e) => ({ ...e, settled: false })),
  ];
  const { start, end } = recentWindow(
    all.length,
    all.findIndex((e) => e.ymd === today),
    COLLAPSED_HISTORY_WEEKS * 7,
    7
  );
  const collapsible = end - start < all.length;
  const entries = showAll || !collapsible ? all : all.slice(start, end);

  return (
    <>
    <div className="grid grid-cols-7 gap-2">
      {entries.map((entry) => {
        const explained = Boolean(reflectionsByDate.get(entry.ymd)?.missReason);
        const cellClass =
          "flex h-9 items-center justify-center rounded-md text-xs " +
          (entry.state === "done"
            ? "bg-foreground text-background"
            : entry.state === "missed"
              ? "bg-destructive/15 text-destructive"
              : entry.state === "today"
                ? "border-2 border-primary text-foreground"
                : // A skipped day is drawn as an outline rather than a fill:
                  // it's a hole in the record by arrangement, and the one
                  // thing it must never read as is either a day kept or a day
                  // dropped.
                  entry.state === "skipped"
                  ? "border border-dashed border-muted-foreground/50 text-muted-foreground"
                  : "bg-secondary text-muted-foreground");

        if (entry.state !== "missed" || entry.settled) {
          return (
            <div
              key={entry.ymd}
              title={
                entry.state === "skipped"
                  ? `${formatYmd(entry.ymd)}: time off — nothing was due`
                  : `${formatYmd(entry.ymd)}: ${entry.state}`
              }
              className={cellClass}
            >
              {formatYmd(entry.ymd, "d")}
            </div>
          );
        }

        return (
          <button
            key={entry.ymd}
            type="button"
            onClick={() => onSelectMiss({ ymd: entry.ymd, kind: "day" })}
            title={`${formatYmd(entry.ymd)}: missed${explained ? " — reason noted" : ""}`}
            aria-label={`${formatYmd(entry.ymd)}: missed. ${
              explained ? "Reason noted — edit it." : "Note what got in the way."
            }`}
            // The ring is what marks a cell as tappable, and every tappable
            // cell gets one — hover says nothing on a phone, and until now the
            // only cells that looked any different were the ones already
            // explained, i.e. the ones you no longer needed to find.
            className={
              cellClass +
              " relative ring-1 ring-inset transition-colors hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" +
              (explained ? " ring-destructive" : " ring-destructive/50")
            }
          >
            {formatYmd(entry.ymd, "d")}
            {explained && (
              <span
                aria-hidden
                className="absolute bottom-1 h-1 w-1 rounded-full bg-destructive"
              />
            )}
          </button>
        );
      })}
    </div>
    {collapsible && (
      <Button
        variant="ghost"
        size="sm"
        className="mt-3 w-full"
        onClick={() => setShowAll((v) => !v)}
      >
        {showAll
          ? `Show recent ${COLLAPSED_HISTORY_WEEKS} weeks`
          : `Show all ${all.length} days`}
      </Button>
    )}
    </>
  );
}

function WeeklyWindowList({
  challenge,
  checkinYmds,
  today,
  memberJoinedDate,
  away,
  pastCycles,
  sparesByWindow,
  reflectionsByDate,
  onSelectMiss,
}: {
  challenge: Challenge;
  checkinYmds: string[];
  today: string;
  memberJoinedDate?: string;
  away?: ReadonlySet<string>;
  pastCycles: PastCycle[];
  sparesByWindow: SpareCoverage;
} & HistoryReflectionProps) {
  const [showAll, setShowAll] = useState(false);
  // Earlier cycles first. Week numbers already run continuously across them
  // (each cycle carries its own weeksBefore), so this reads as weeks 1..n of
  // one habit rather than three separate runs that each start at 1. They're
  // marked settled: a note tapped onto one would be filed against the wrong
  // challenge, since reflections live per-cycle.
  const all = [
    ...pastCycles.flatMap((c) =>
      weeklyWindows(
        c.challenge,
        c.checkinYmds,
        today,
        c.joinedDate,
        c.away
      ).map((w) => ({
        ...w,
        settled: true,
        fullTarget: c.challenge.frequency.target,
      }))
    ),
    ...weeklyWindows(challenge, checkinYmds, today, memberJoinedDate, away).map(
      (w) => ({
        ...w,
        settled: false,
        fullTarget: challenge.frequency.target,
      })
    ),
  ];
  const { start, end } = recentWindow(
    all.length,
    all.findIndex((w) => w.state === "current"),
    COLLAPSED_HISTORY_WEEKS
  );
  const collapsible = end - start < all.length;
  const windows = showAll || !collapsible ? all : all.slice(start, end);

  return (
    <>
    <div className="flex flex-col gap-2">
      {windows.map((w) => {
        // A weekly habit misses a window, not a day, so the reflection for one
        // is keyed on the window's start date.
        const explained = Boolean(reflectionsByDate.get(w.start)?.missReason);
        const spares = w.settled ? 0 : (sparesByWindow.get(w.start) ?? 0);
        // Covered weeks stop reading as failures — that's what spending the
        // spare bought. A shortfall bigger than the spares on it still does.
        const covered = spares > 0 && spares >= w.target - w.count;
        const skipped = w.state === "skipped";
        // Without this, a prorated week reads as "2/2" beside its neighbours'
        // "5/5" with nothing to explain the different denominator — which
        // looks like a bug rather than the fairness adjustment it is.
        const proratedNote = w.prorated
          ? `You joined partway through this week, so ${w.target} of the usual ${w.fullTarget} were required.`
          : undefined;
        const weekLabel = (
          <span className="min-w-0">
            Week {w.index} · {formatYmd(w.start)} – {formatYmd(w.end)}
            {w.prorated && !skipped && w.awayDays === 0 && (
              <span className="text-muted-foreground"> · joined mid-week</span>
            )}
            {!skipped && w.awayDays > 0 && (
              <span className="text-muted-foreground">
                {" "}
                · {w.awayDays} day{w.awayDays === 1 ? "" : "s"} off
              </span>
            )}
          </span>
        );
        const failing = w.state === "past-incomplete" && !covered;
        const count = (
          <span
            className={
              w.state === "complete"
                ? "font-bold text-foreground"
                : failing
                  ? "font-medium text-destructive"
                  : w.state === "past-incomplete"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
            }
          >
            {/* "0/0" is arithmetically right and says nothing. A week that
                asked for nothing should say so. */}
            {skipped ? "Time off" : `${w.count}/${w.target}`}
          </span>
        );
        const spareMark = spares > 0 && (
          <span
            className="shrink-0 font-medium text-foreground"
            title={`${spares} spare skip${spares === 1 ? "" : "s"} applied to this week`}
          >
            ◆ {spares}
          </span>
        );

        // A week with spares on it stays tappable even once they cover it —
        // otherwise a spare applied to a week later salvaged by a backfill
        // would be stranded on a row that no longer opened, with no way to
        // take it back.
        const tappable = !w.settled && (w.state === "past-incomplete" || spares > 0);
        if (!tappable) {
          return (
            <div
              key={w.index}
              title={proratedNote}
              className={
                "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm " +
                (skipped
                  ? "border border-dashed text-muted-foreground"
                  : "border")
              }
            >
              {weekLabel}
              <span className="flex shrink-0 items-center gap-1.5">
                {spareMark}
                {count}
              </span>
            </div>
          );
        }

        return (
          <button
            key={w.index}
            type="button"
            onClick={() => onSelectMiss({ ymd: w.start, kind: "window" })}
            title={proratedNote}
            aria-label={`Week ${w.index}, ${w.count} of ${w.target}. ${
              proratedNote ? proratedNote + " " : ""
            }${spares > 0 ? `Covered by ${spares} spare skip${spares === 1 ? "" : "s"}. ` : ""}${
              explained ? "Reason noted — edit it." : "Note what got in the way."
            }`}
            className={
              "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" +
              (!failing
                ? " border-input"
                : explained
                  ? " border-destructive"
                  : " border-destructive/50")
            }
          >
            {weekLabel}
            {/* A chevron, because a row that only differs by border colour
                doesn't read as a control — this is the one shape a list row
                can take that everyone already knows means "opens something". */}
            <span className="flex shrink-0 items-center gap-1.5">
              {spareMark}
              {count}
              {explained && (
                <span
                  aria-hidden
                  className={
                    "h-1.5 w-1.5 rounded-full " +
                    (failing ? "bg-destructive" : "bg-muted-foreground")
                  }
                />
              )}
              <span
                aria-hidden
                className={failing ? "text-destructive" : "text-muted-foreground"}
              >
                ›
              </span>
            </span>
          </button>
        );
      })}
    </div>
    {collapsible && (
      <Button
        variant="ghost"
        size="sm"
        className="mt-3 w-full"
        onClick={() => setShowAll((v) => !v)}
      >
        {showAll
          ? `Show recent ${COLLAPSED_HISTORY_WEEKS} weeks`
          : `Show all ${all.length} weeks`}
      </Button>
    )}
    </>
  );
}

/**
 * The habit's record: a grid of days, or a list of weeks.
 *
 * Owns the daily/weekly choice and the tap-a-miss invitation rather than
 * leaving them to the page, because the three move together — the invitation
 * is only true when the grid below it actually has a tappable cell, and
 * `hasTappableMiss` is the same predicate the grid uses to decide. Splitting
 * them across two files is how they drifted apart the first time.
 */
export function HistoryCard({
  challenge,
  weekChallenge,
  checkinYmds,
  today,
  memberJoinedDate,
  away,
  pastCycles,
  sparesByWindow,
  spareAvailable,
  reflectionsByDate,
  onSelectMiss,
}: {
  challenge: Challenge;
  /** Chain-corrected copy for week numbering — see chainWeekOffsets. */
  weekChallenge: Challenge;
  challengeId?: never;
  checkinYmds: string[];
  today: string;
  memberJoinedDate?: string;
  /** Days this cycle excuses — see lib/away.ts. */
  away?: ReadonlySet<string>;
  pastCycles: PastCycle[];
  /** Spares on this cycle's weeks, keyed on window start. */
  sparesByWindow: SpareCoverage;
  /** Whether there's a spare left to offer — changes what a tap is *for*. */
  spareAvailable: boolean;
} & HistoryReflectionProps) {
  const daily = challenge.frequency.type === "daily";
  const tappable = hasTappableMiss(
    challenge,
    checkinYmds,
    today,
    memberJoinedDate,
    away
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>History</CardTitle>
        {/* Only offered when there's something to accept it. And when a spare
            is available, that's the more useful half of what the tap does —
            one changes the result, the other is a private note. */}
        {tappable && (
          <CardDescription>
            {!daily && spareAvailable ? (
              <>
                Tap a missed week to spend a spare skip on it, or to note what
                got in the way.
              </>
            ) : (
              <>
                Tap a missed {daily ? "day" : "week"} to note what got in the way
                — just for you, and it won&apos;t change the result.
              </>
            )}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {daily ? (
          <DailyHistoryGrid
            challenge={challenge}
            checkinYmds={checkinYmds}
            today={today}
            memberJoinedDate={memberJoinedDate}
            away={away}
            pastCycles={pastCycles}
            reflectionsByDate={reflectionsByDate}
            onSelectMiss={onSelectMiss}
          />
        ) : (
          <WeeklyWindowList
            // The chain-corrected copy: this list is where "week 1 twice" was
            // actually visible.
            challenge={weekChallenge}
            checkinYmds={checkinYmds}
            today={today}
            memberJoinedDate={memberJoinedDate}
            away={away}
            pastCycles={pastCycles}
            sparesByWindow={sparesByWindow}
            reflectionsByDate={reflectionsByDate}
            onSelectMiss={onSelectMiss}
          />
        )}
      </CardContent>
    </Card>
  );
}
