import { addDaysYmd, ymdToDate } from "@/lib/dates";
import { dailyHistory, weeklyWindows } from "@/lib/progress";
import type { Challenge } from "@/lib/types";

function streakFloor(challenge: Challenge): string {
  return challenge.streakResetAt && challenge.streakResetAt > challenge.startDate
    ? challenge.streakResetAt
    : challenge.startDate;
}

export interface StreakRun {
  streak: number;
  /**
   * Whether the run is unbroken all the way back to the challenge's own
   * floor (its startDate, or streakResetAt if later) — i.e. there's no
   * miss/incomplete window between the floor and `asOf`. Used by
   * chain-streak.ts to decide whether it's safe to keep counting into the
   * cycle this challenge was repeated from.
   */
  reachesFloor: boolean;
  /**
   * Calendar days the run covers, as opposed to `streak`'s count of days
   * actually checked in. Identical for a daily habit; for an N×/week habit
   * they diverge — 50 check-ins at 5×/week span 70 days — which is exactly
   * the "how long has this been going?" the streak number alone can't
   * answer, and what the UI renders as "N weeks unbroken".
   */
  spanDays: number;
}

/**
 * The live streak run, in DAYS for both frequency types (the hero labels
 * this number "days"), as of `asOf` (usually today for a still-running
 * challenge; a fixed date for an already-ended one — see chain-streak.ts,
 * which passes `addDaysYmd(endDate, 1)` to get the *settled* trailing
 * streak of a cycle that's fully in the past).
 *
 * Daily challenges count backward day by day — a rest day breaks the run.
 * weekly_count challenges also count check-in DAYS — one per day done, so
 * the very first check-in reads as a streak of 1 immediately — but their
 * break condition is window-based rather than day-based: an N-times-a-week
 * habit has planned rest days by design, so the streak only resets when a
 * week actually fails (a window ends short of its target). This used to
 * count completed windows as the streak unit instead, which meant a brand
 * new weekly habit showed 0 for its entire first week no matter how many
 * days were checked in.
 *
 * `challenge.streakResetAt` (set when an edit increases skipDays — see
 * editChallengeAdmin) acts as a floor: checkins before it are invisible to
 * this calculation, so raising skips reads as "starting a new streak" even
 * though the challenge itself keeps running. Deliberately doesn't affect
 * `longestStreak` below — that's a historical best-ever record, not the
 * live one, and isn't part of what a skip-days edit resets.
 */
export function streakRun(
  challenge: Challenge,
  checkinYmds: ReadonlySet<string> | readonly string[],
  asOf: string
): StreakRun {
  const checkins =
    checkinYmds instanceof Set ? checkinYmds : new Set(checkinYmds);
  const floor = streakFloor(challenge);

  if (challenge.frequency.type === "daily") {
    let cursor = checkins.has(asOf) ? asOf : addDaysYmd(asOf, -1);
    let streak = 0;
    while (cursor >= floor && checkins.has(cursor)) {
      streak++;
      cursor = addDaysYmd(cursor, -1);
    }
    // Every day in a daily run is a consecutive calendar day, so the run's
    // span and its count are the same number.
    return { streak, reachesFloor: cursor < floor, spanDays: streak };
  }

  // Floor the CHECKINS, not the windows: a reset can land mid-window (the
  // 7-day windows are anchored to startDate, not to streakResetAt), and
  // filtering whole windows by `start >= floor` threw away every checkin
  // in a window that straddled the boundary — including ones that landed
  // after the reset and should still count toward it. Flooring checkins
  // first lets that window's count reflect only its post-reset checkins
  // (correctly excluding pre-reset ones without discarding the window
  // itself), while windows entirely before the floor naturally end up with
  // a count of 0 and get excluded below via `end >= floor` (equivalent to
  // "nothing here is reachable, so this is where the floor is").
  const flooredCheckins = Array.from(checkins).filter((d) => d >= floor);
  const windows = weeklyWindows(challenge, flooredCheckins, asOf).filter(
    (w) => w.end >= floor
  );
  // The streak breaks at the most recent window that actually failed;
  // check-in days after it (complete windows and the still-undecided
  // current one alike) all count, one day each.
  let lastFailedEnd: string | null = null;
  for (const w of windows) {
    if (w.state === "past-incomplete") lastFailedEnd = w.end;
  }
  const streak = flooredCheckins.filter(
    (d) => lastFailedEnd === null || d > lastFailedEnd
  ).length;
  // One whole week of calendar time per week actually secured. A week that
  // hit its target early counts immediately — it can no longer be failed —
  // while the still-undecided current week doesn't, so the span never claims
  // time that hasn't been earned yet.
  const weeksSecured = windows.filter(
    (w) =>
      (lastFailedEnd === null || w.start > lastFailedEnd) && w.state === "complete"
  ).length;
  return {
    streak,
    reachesFloor: lastFailedEnd === null,
    spanDays: weeksSecured * 7,
  };
}

/** currentStreak(...) === streakRun(..., today).streak — kept for the (many) callers that just want the number. */
export function currentStreak(
  challenge: Challenge,
  checkinYmds: ReadonlySet<string> | readonly string[],
  today: string
): number {
  return streakRun(challenge, checkinYmds, today).streak;
}

/**
 * Longest run ever completed (not required to be ongoing), for a "best"
 * stat — in DAYS for both frequency types, same units as streakRun above.
 *
 * Exported for the leaderboard's all-time column, which runs it over a
 * synthetic challenge spanning a whole repeat-chain (see lib/server/
 * leaderboard.ts) so a run straddling a cycle boundary isn't truncated.
 */
export function longestStreak(
  challenge: Challenge,
  checkinYmds: ReadonlySet<string> | readonly string[],
  today: string
): number {
  const checkins =
    checkinYmds instanceof Set ? checkinYmds : new Set(checkinYmds);

  if (challenge.frequency.type === "daily") {
    let best = 0;
    let run = 0;
    for (const day of dailyHistory(challenge, checkins, today)) {
      if (day.state === "done") {
        run++;
        best = Math.max(best, run);
      } else if (day.state === "missed") {
        run = 0;
      }
    }
    return best;
  }

  // Chronological walk over the window grid, accumulating each window's
  // check-in DAYS; a failed window zeroes the run (its own days don't
  // count — that week broke the habit), mirroring streakRun's semantics.
  const sorted = Array.from(checkins);
  let best = 0;
  let run = 0;
  for (const w of weeklyWindows(challenge, sorted, today)) {
    if (w.state === "complete" || w.state === "current") {
      run += sorted.filter((d) => d >= w.start && d <= w.end).length;
      best = Math.max(best, run);
    } else if (w.state === "past-incomplete") {
      run = 0;
    }
  }
  return best;
}

/** The largest current streak across a set of challenges (the hero number). */
export function maxCurrentStreak(
  challenges: readonly Challenge[],
  checkinsByChallenge: Readonly<Record<string, readonly string[]>>,
  today: string
): number {
  return challenges.reduce(
    (max, c) =>
      Math.max(max, currentStreak(c, checkinsByChallenge[c.id] ?? [], today)),
    0
  );
}

/** The largest best-ever streak across a set of challenges. */
export function maxLongestStreak(
  challenges: readonly Challenge[],
  checkinsByChallenge: Readonly<Record<string, readonly string[]>>,
  today: string
): number {
  return challenges.reduce(
    (max, c) =>
      Math.max(max, longestStreak(c, checkinsByChallenge[c.id] ?? [], today)),
    0
  );
}

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export interface WeekStripDay {
  ymd: string;
  letter: string;
  state: "done" | "empty";
  isToday: boolean;
}

/** The current Mon–Sun week, each day marked "done" if any activity landed on it. */
export function weekStripDays(
  activityYmds: ReadonlySet<string> | readonly string[],
  today: string
): WeekStripDay[] {
  const activity =
    activityYmds instanceof Set ? activityYmds : new Set(activityYmds);
  const dow = ymdToDate(today).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  const monday = addDaysYmd(today, -daysSinceMonday);

  return DAY_LETTERS.map((letter, i) => {
    const ymd = addDaysYmd(monday, i);
    return {
      ymd,
      letter,
      state: ymd <= today && activity.has(ymd) ? "done" : "empty",
      isToday: ymd === today,
    };
  });
}

/** % of elapsed days this week (Monday through today) marked "done". */
export function weekStripPercent(days: WeekStripDay[], today: string): number {
  const elapsed = days.filter((d) => d.ymd <= today);
  if (elapsed.length === 0) return 0;
  const done = elapsed.filter((d) => d.state === "done").length;
  return Math.round((done / elapsed.length) * 100);
}
