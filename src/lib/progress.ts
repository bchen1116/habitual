import { addDaysYmd, daysBetweenInclusive, todayYmd } from "@/lib/dates";
import type { Challenge } from "@/lib/types";

export type ChallengeState = "upcoming" | "active" | "ended" | "cancelled";

/**
 * The lifecycle state as seen by one member "today" (their local date).
 * "ended" means past endDate but not yet adjudicated (that's step 3).
 */
export function challengeState(challenge: Challenge, today: string): ChallengeState {
  if (challenge.status === "cancelled") return "cancelled";
  if (today < challenge.startDate) return "upcoming";
  if (today > challenge.endDate) return "ended";
  return "active";
}

/** Total check-ins needed to fully complete the challenge. */
export function totalRequired(challenge: Challenge): number {
  const days = daysBetweenInclusive(challenge.startDate, challenge.endDate);
  if (challenge.frequency.type === "daily") return days;
  return challenge.frequency.target * Math.floor(days / 7);
}

export interface DayEntry {
  ymd: string;
  state: "done" | "missed" | "today" | "future";
}

/** Per-day history for daily challenges. */
export function dailyHistory(
  challenge: Challenge,
  checkinYmds: ReadonlySet<string>,
  today: string
): DayEntry[] {
  const days = daysBetweenInclusive(challenge.startDate, challenge.endDate);
  const entries: DayEntry[] = [];
  for (let i = 0; i < days; i++) {
    const ymd = addDaysYmd(challenge.startDate, i);
    if (checkinYmds.has(ymd)) {
      entries.push({ ymd, state: "done" });
    } else if (ymd === today) {
      entries.push({ ymd, state: "today" });
    } else if (ymd < today) {
      entries.push({ ymd, state: "missed" });
    } else {
      entries.push({ ymd, state: "future" });
    }
  }
  return entries;
}

export interface WindowEntry {
  index: number; // 1-based week number
  start: string;
  end: string;
  count: number;
  target: number;
  state: "complete" | "current" | "past-incomplete" | "future";
}

/** Sequential 7-day windows for weekly_count challenges (docs/02 semantics). */
export function weeklyWindows(
  challenge: Challenge,
  checkinYmds: readonly string[],
  today: string
): WindowEntry[] {
  const days = daysBetweenInclusive(challenge.startDate, challenge.endDate);
  const weeks = Math.floor(days / 7);
  const target = challenge.frequency.target;
  const windows: WindowEntry[] = [];
  for (let w = 0; w < weeks; w++) {
    const start = addDaysYmd(challenge.startDate, w * 7);
    const end = addDaysYmd(start, 6);
    const count = checkinYmds.filter((d) => d >= start && d <= end).length;
    let state: WindowEntry["state"];
    if (count >= target) state = "complete";
    else if (today > end) state = "past-incomplete";
    else if (today >= start) state = "current";
    else state = "future";
    windows.push({ index: w + 1, start, end, count, target, state });
  }
  return windows;
}

/**
 * Skips consumed so far, live. Mirrors the adjudication math (docs/03) but
 * only counts days/windows that are fully in the past — today and the
 * current window are still salvageable, so they don't consume skips yet.
 */
export function skipsUsed(
  challenge: Challenge,
  checkinYmds: readonly string[],
  today: string
): number {
  if (challenge.frequency.type === "daily") {
    const lastCountable =
      today > challenge.endDate ? challenge.endDate : addDaysYmd(today, -1);
    if (lastCountable < challenge.startDate) return 0;
    const elapsed = daysBetweenInclusive(challenge.startDate, lastCountable);
    const done = checkinYmds.filter(
      (d) => d >= challenge.startDate && d <= lastCountable
    ).length;
    return Math.max(0, elapsed - done);
  }
  return weeklyWindows(challenge, checkinYmds, today)
    .filter((w) => w.state === "past-incomplete" || (today > challenge.endDate && w.state !== "complete"))
    .reduce((sum, w) => sum + Math.max(0, w.target - w.count), 0);
}

export interface ProgressSummary {
  completed: number;
  total: number;
  skipsUsed: number;
  daysRemaining: number; // 0 when ended
  checkedInToday: boolean;
  canCheckInToday: boolean;
}

export function progressSummary(
  challenge: Challenge,
  checkinYmds: readonly string[],
  timezone: string
): ProgressSummary {
  const today = todayYmd(timezone);
  const state = challengeState(challenge, today);
  const inRange = checkinYmds.filter(
    (d) => d >= challenge.startDate && d <= challenge.endDate
  );
  const checkedInToday = inRange.includes(today);
  return {
    completed: inRange.length,
    total: totalRequired(challenge),
    skipsUsed: skipsUsed(challenge, inRange, today),
    daysRemaining:
      state === "active" ? daysBetweenInclusive(today, challenge.endDate) : 0,
    checkedInToday,
    canCheckInToday: state === "active" && !checkedInToday,
  };
}
