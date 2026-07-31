import { addDaysYmd, daysBetweenInclusive, formatYmd, todayYmd } from "@/lib/dates";
import type { Challenge } from "@/lib/types";

export type ChallengeState =
  | "upcoming"
  | "active"
  | "ended"
  | "cancelled"
  | "adjudicated";

/**
 * The lifecycle state as seen by one member "today" (their local date).
 * "ended" means past endDate but not yet adjudicated.
 */
export function challengeState(challenge: Challenge, today: string): ChallengeState {
  if (challenge.status === "cancelled") return "cancelled";
  if (challenge.status === "adjudicated") return "adjudicated";
  if (today < challenge.startDate) return "upcoming";
  if (today > challenge.endDate) return "ended";
  return "active";
}

/**
 * A member's own starting point for "days/weeks required" purposes: the
 * challenge's startDate, unless they joined after it started (joining
 * mid-challenge is allowed — see joinChallengeAdmin), in which case it's
 * their own joinedDate instead. Without this, anyone who joins late would
 * immediately show as having missed every day between the challenge's start
 * and the day they joined — days they weren't even a member yet.
 */
export function effectiveStart(challenge: Challenge, memberJoinedDate?: string): string {
  return memberJoinedDate && memberJoinedDate > challenge.startDate
    ? memberJoinedDate
    : challenge.startDate;
}

/** The full sequential 7-day window grid, anchored to the challenge's own startDate for everyone. */
function weekWindowBounds(challenge: Challenge): { start: string; end: string }[] {
  const days = daysBetweenInclusive(challenge.startDate, challenge.endDate);
  const weeks = Math.floor(days / 7);
  return Array.from({ length: weeks }, (_, w) => {
    const start = addDaysYmd(challenge.startDate, w * 7);
    return { start, end: addDaysYmd(start, 6) };
  });
}

/**
 * How many check-ins one 7-day window actually demands of one member.
 *
 * Windows that concluded before they joined are waived outright, and windows
 * that begin on or after their start owe the full target. The interesting
 * case is the window they land in the middle of, which is prorated by the
 * days they actually have.
 *
 * The `daysAvailable` cap is the part that matters most: only one check-in
 * can exist per member per day (the doc id is `${localDate}_${uid}`), so
 * without it a 5×/week habit joined on a Saturday would owe 5 check-ins
 * across 2 remaining days — a shortfall charged for something no amount of
 * effort could have prevented, and one that could fail the whole challenge
 * and move real money before the member had lived a single full week.
 * `ceil` keeps the prorated figure demanding rather than generous, and the
 * result is never 0, so joining mid-window is never a free pass either.
 *
 * Mirrored in functions/src/adjudicate.ts — that copy is the one that decides
 * money, this one is what the UI promises. They have to agree.
 */
export function windowRequirement(
  target: number,
  windowStart: string,
  windowEnd: string,
  memberStart: string
): number {
  if (windowEnd < memberStart) return 0;
  if (windowStart >= memberStart) return target;
  const daysAvailable = daysBetweenInclusive(memberStart, windowEnd);
  return Math.min(daysAvailable, Math.ceil((target * daysAvailable) / 7));
}

/** Total check-ins needed to fully complete the challenge, from a member's own effective start onward. */
export function totalRequired(challenge: Challenge, memberJoinedDate?: string): number {
  const start = effectiveStart(challenge, memberJoinedDate);
  if (start > challenge.endDate) return 0;
  if (challenge.frequency.type === "daily") {
    return daysBetweenInclusive(start, challenge.endDate);
  }
  return weekWindowBounds(challenge).reduce(
    (sum, w) =>
      sum + windowRequirement(challenge.frequency.target, w.start, w.end, start),
    0
  );
}

export interface DayEntry {
  ymd: string;
  state: "done" | "missed" | "today" | "future";
}

/** Per-day history for daily challenges, from a member's own effective start onward. */
export function dailyHistory(
  challenge: Challenge,
  checkinYmds: ReadonlySet<string>,
  today: string,
  memberJoinedDate?: string
): DayEntry[] {
  const start = effectiveStart(challenge, memberJoinedDate);
  if (start > challenge.endDate) return [];
  const days = daysBetweenInclusive(start, challenge.endDate);
  const entries: DayEntry[] = [];
  for (let i = 0; i < days; i++) {
    const ymd = addDaysYmd(start, i);
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
  index: number; // 1-based week number, relative to the challenge's own grid
  start: string;
  end: string;
  count: number;
  /** This member's requirement for the window — prorated if they joined into it. */
  target: number;
  /** True when `target` is below the challenge's, i.e. they joined mid-window. */
  prorated: boolean;
  state: "complete" | "current" | "past-incomplete" | "future";
}

/**
 * Sequential 7-day windows for weekly_count challenges (docs/02 semantics).
 * The grid itself always stays anchored to the challenge's startDate, even
 * for a member who joined late — only windows that fully concluded before
 * `memberJoinedDate` are dropped, so `index` still reflects each window's
 * true week number rather than being renumbered from 1.
 */
export function weeklyWindows(
  challenge: Challenge,
  checkinYmds: readonly string[],
  today: string,
  memberJoinedDate?: string
): WindowEntry[] {
  const start = effectiveStart(challenge, memberJoinedDate);
  const fullTarget = challenge.frequency.target;
  const windows: WindowEntry[] = [];
  weekWindowBounds(challenge).forEach((bounds, w) => {
    if (bounds.end < start) return;
    const target = windowRequirement(fullTarget, bounds.start, bounds.end, start);
    const count = checkinYmds.filter((d) => d >= bounds.start && d <= bounds.end).length;
    let state: WindowEntry["state"];
    if (count >= target) state = "complete";
    else if (today > bounds.end) state = "past-incomplete";
    else if (today >= bounds.start) state = "current";
    else state = "future";
    windows.push({
      index: w + 1,
      start: bounds.start,
      end: bounds.end,
      count,
      target,
      prorated: target < fullTarget,
      state,
    });
  });
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
  today: string,
  memberJoinedDate?: string
): number {
  const start = effectiveStart(challenge, memberJoinedDate);
  if (challenge.frequency.type === "daily") {
    const lastCountable =
      today > challenge.endDate ? challenge.endDate : addDaysYmd(today, -1);
    if (lastCountable < start) return 0;
    const elapsed = daysBetweenInclusive(start, lastCountable);
    const done = checkinYmds.filter(
      (d) => d >= start && d <= lastCountable
    ).length;
    return Math.max(0, elapsed - done);
  }
  // Every window's `end` is <= challenge.endDate (weeklyWindows' loop bound),
  // so once today > endDate every non-"complete" window is already forced to
  // "past-incomplete" by weeklyWindows' own state logic — a plain
  // "past-incomplete" filter already covers the ended-challenge case.
  return weeklyWindows(challenge, checkinYmds, today, memberJoinedDate)
    .filter((w) => w.state === "past-incomplete")
    .reduce((sum, w) => sum + Math.max(0, w.target - w.count), 0);
}

export interface HabitWeekDay {
  ymd: string;
  /** Narrow weekday initial for that actual date — F for a Friday, not a fixed grid. */
  letter: string;
  /** "inactive": inside the window but before this member joined — never a miss. */
  state: "done" | "missed" | "today" | "future" | "inactive";
}

export interface HabitWeek {
  index: number; // 1-based, within the habit's own window grid
  totalWeeks: number;
  start: string;
  end: string;
  days: HabitWeekDay[];
  /** Check-ins landed so far this window. */
  count: number;
  /** What this window asks of this member (prorated if they joined into it). */
  target: number;
  /**
   * Whether check-ins past `target` are possible at all. True for
   * weekly_count, where the target is below the number of days; false for
   * daily, which already asks for every day there is.
   */
  allowsExtras: boolean;
  /** Whether any day in the window is still today or ahead of it. */
  daysLeft: boolean;
}

/**
 * The habit's *current* seven days — its own week, not the calendar's.
 *
 * The windows are anchored to `startDate` for every purpose that matters
 * (adjudication, skips, the History list), so a habit that began on a Friday
 * runs Friday-to-Thursday and its second week starts the following Friday.
 * The dashboard's "This week" strip is Monday-anchored on purpose — it spans
 * every habit at once, so it has no single start day to follow — which left
 * nowhere in the app showing a habit's week the way the habit actually
 * counts it.
 *
 * Before the habit starts this reports week 1, and after it ends the final
 * week, so the strip always has something true to show rather than vanishing
 * at exactly the moments people go looking at it.
 */
export function habitWeek(
  challenge: Challenge,
  checkinYmds: readonly string[],
  today: string,
  memberJoinedDate?: string
): HabitWeek | null {
  const bounds = weekWindowBounds(challenge);
  if (bounds.length === 0) return null;

  let index = bounds.findIndex((w) => today >= w.start && today <= w.end);
  if (index === -1) index = today < challenge.startDate ? 0 : bounds.length - 1;
  const { start, end } = bounds[index];

  const memberStart = effectiveStart(challenge, memberJoinedDate);
  const done = new Set(checkinYmds);
  const days: HabitWeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const ymd = addDaysYmd(start, i);
    const letter = formatYmd(ymd, "EEEEE");
    let state: HabitWeekDay["state"];
    if (done.has(ymd)) state = "done";
    else if (ymd < memberStart) state = "inactive";
    else if (ymd === today) state = "today";
    else if (ymd < today) state = "missed";
    else state = "future";
    days.push({ ymd, letter, state });
  }

  // Daily habits store frequency.target as 1 (see createChallengeAdmin), so
  // their real requirement is "every day you're a member", not that number.
  const target =
    challenge.frequency.type === "daily"
      ? days.filter((d) => d.state !== "inactive").length
      : windowRequirement(challenge.frequency.target, start, end, memberStart);

  return {
    index: index + 1,
    totalWeeks: bounds.length,
    start,
    end,
    days,
    count: days.filter((d) => d.state === "done").length,
    target,
    allowsExtras: challenge.frequency.type === "weekly_count",
    daysLeft: days.some((d) => d.state === "today" || d.state === "future"),
  };
}

/**
 * Which slice of a start-anchored history to render when showing all of it
 * at once would be unusable — a year-long daily habit is 364 cells, and the
 * card would be taller than several screens.
 *
 * The slice ends at the boundary of the group containing `currentIndex`
 * (today's row, or the current week), not at the end of the list: for a habit
 * on day 4 of 364 the last 8 rows are entirely in the future, which is the
 * opposite of what a history is for. When `currentIndex` is outside the list —
 * an upcoming or already-ended habit — it anchors to the final group instead.
 *
 * `groupSize` keeps grid rows intact: with 7, both ends land on a row
 * boundary, so the 7-column layout stays aligned to the same weekday columns
 * it had before collapsing.
 */
export function recentWindow(
  total: number,
  currentIndex: number,
  maxItems: number,
  groupSize = 1
): { start: number; end: number } {
  if (total <= maxItems) return { start: 0, end: total };
  const anchor = currentIndex >= 0 && currentIndex < total ? currentIndex : total - 1;
  const end = Math.min(total, (Math.floor(anchor / groupSize) + 1) * groupSize);
  return { start: Math.max(0, end - maxItems), end };
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
  timezone: string,
  memberJoinedDate?: string
): ProgressSummary {
  const today = todayYmd(timezone);
  const state = challengeState(challenge, today);
  const inRange = checkinYmds.filter(
    (d) => d >= challenge.startDate && d <= challenge.endDate
  );
  const checkedInToday = inRange.includes(today);
  return {
    completed: inRange.length,
    total: totalRequired(challenge, memberJoinedDate),
    skipsUsed: skipsUsed(challenge, inRange, today, memberJoinedDate),
    daysRemaining:
      state === "active" ? daysBetweenInclusive(today, challenge.endDate) : 0,
    checkedInToday,
    canCheckInToday: state === "active" && !checkedInToday,
  };
}
