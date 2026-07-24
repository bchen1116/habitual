import { addDaysYmd, ymdToDate } from "@/lib/dates";
import { dailyHistory, weeklyWindows } from "@/lib/progress";
import type { Challenge } from "@/lib/types";

/**
 * Consecutive-completion streak, ending at the most recent day/window that
 * could still be "current". Daily challenges count backward day by day;
 * weekly_count challenges count backward window by window (skipping an
 * in-progress current window rather than treating it as a break, since it
 * hasn't been decided yet).
 *
 * `challenge.streakResetAt` (set when an edit increases skipDays — see
 * editChallengeAdmin) acts as a floor: checkins before it are invisible to
 * this calculation, so raising skips reads as "starting a new streak" even
 * though the challenge itself keeps running. Deliberately doesn't affect
 * `longestStreak` below — that's a historical best-ever record, not the
 * live one, and isn't part of what a skip-days edit resets.
 */
export function currentStreak(
  challenge: Challenge,
  checkinYmds: ReadonlySet<string> | readonly string[],
  today: string
): number {
  const checkins =
    checkinYmds instanceof Set ? checkinYmds : new Set(checkinYmds);
  const floor =
    challenge.streakResetAt && challenge.streakResetAt > challenge.startDate
      ? challenge.streakResetAt
      : challenge.startDate;

  if (challenge.frequency.type === "daily") {
    let cursor = checkins.has(today) ? today : addDaysYmd(today, -1);
    let streak = 0;
    while (cursor >= floor && checkins.has(cursor)) {
      streak++;
      cursor = addDaysYmd(cursor, -1);
    }
    return streak;
  }

  const windows = weeklyWindows(challenge, Array.from(checkins), today).filter(
    (w) => w.start >= floor
  );
  let i = windows.length - 1;
  while (i >= 0 && windows[i].state === "future") i--;
  if (i >= 0 && windows[i].state === "current") i--; // undecided, skip without breaking
  let streak = 0;
  while (i >= 0 && windows[i].state === "complete") {
    streak++;
    i--;
  }
  return streak;
}

/** Longest run ever completed (not required to be ongoing), for a "best" stat. */
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

  let best = 0;
  let run = 0;
  for (const w of weeklyWindows(challenge, Array.from(checkins), today)) {
    if (w.state === "complete") {
      run++;
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
