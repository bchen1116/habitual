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
 * Days of one 7-day window that a member was actually available for: on or
 * after their own start, and not declared away (lib/away.ts).
 *
 * The two exclusions are one idea — days that were never theirs to use — and
 * collapsing them is what let time off be added without a second, parallel
 * proration rule that would inevitably have disagreed with this one.
 */
export function windowDaysAvailable(
  windowStart: string,
  windowEnd: string,
  memberStart: string,
  away?: ReadonlySet<string>
): number {
  if (windowEnd < memberStart) return 0;
  const from = windowStart >= memberStart ? windowStart : memberStart;
  let days = daysBetweenInclusive(from, windowEnd);
  if (away && away.size > 0) {
    for (let ymd = from; ymd <= windowEnd; ymd = addDaysYmd(ymd, 1)) {
      if (away.has(ymd)) days--;
    }
  }
  return Math.max(0, days);
}

/**
 * How many check-ins one 7-day window actually demands of one member.
 *
 * A window they had all seven days of owes the full target. One they had none
 * of — it closed before they joined, or they were away for all of it — owes
 * nothing. In between, it's prorated by the days they actually had.
 *
 * The `daysAvailable` cap is the part that matters most: only one check-in
 * can exist per member per day (the doc id is `${localDate}_${uid}`), so
 * without it a 5×/week habit joined on a Saturday would owe 5 check-ins
 * across 2 remaining days — a shortfall charged for something no amount of
 * effort could have prevented, and one that could fail the whole challenge
 * and move real money before the member had lived a single full week.
 * `ceil` keeps the prorated figure demanding rather than generous, and the
 * result is only 0 when there was genuinely no day to use, so joining
 * mid-window is never a free pass either.
 *
 * Note what proration means for time off on a weekly habit: a 3×/week week
 * with one day away still asks for 3, because six days is ample for three
 * sessions. Relief arrives only when the days left can't reasonably carry the
 * target — which is the honest answer, and not one a "skip the whole week"
 * rule could have given.
 *
 * Mirrored in functions/src/adjudicate.ts — that copy is the one that decides
 * money, this one is what the UI promises. They have to agree.
 */
export function windowRequirement(
  target: number,
  windowStart: string,
  windowEnd: string,
  memberStart: string,
  away?: ReadonlySet<string>
): number {
  const daysAvailable = windowDaysAvailable(
    windowStart,
    windowEnd,
    memberStart,
    away
  );
  if (daysAvailable <= 0) return 0;
  if (daysAvailable >= 7) return target;
  return Math.min(daysAvailable, Math.ceil((target * daysAvailable) / 7));
}

/** Total check-ins needed to fully complete the challenge, from a member's own effective start onward. */
/**
 * Whether the week `today` falls in asks this member for nothing at all.
 *
 * The case a whole-cycle check can't describe: on a four-week habit, one week
 * booked off is well inside the time-off budget, so the member stays in the
 * cycle with a stake and is not "excused" in the way someone who stepped out
 * is. But this week they genuinely owe nothing, and a group looking at their
 * row deserves to know that rather than reading a stalled progress bar and
 * drawing its own conclusion.
 *
 * Expressed as "no days available" rather than "every day is booked off"
 * because those differ for a member who joined mid-cycle, and the first is
 * the one that matches what the window actually demands of them
 * (windowRequirement is built on the same count).
 */
export function excusedThisWeek(
  challenge: Challenge,
  today: string,
  memberJoinedDate?: string,
  away?: ReadonlySet<string>
): boolean {
  if (!away || away.size === 0) return false;
  const window = weekWindowBounds(challenge).find(
    (w) => today >= w.start && today <= w.end
  );
  // No window means today is outside the cycle, or inside a trailing stub of
  // fewer than seven days that the grid never covers. Neither is a week this
  // can speak for.
  if (!window) return false;
  const start = effectiveStart(challenge, memberJoinedDate);
  return windowDaysAvailable(window.start, window.end, start, away) === 0;
}

export function totalRequired(
  challenge: Challenge,
  memberJoinedDate?: string,
  away?: ReadonlySet<string>
): number {
  const start = effectiveStart(challenge, memberJoinedDate);
  if (start > challenge.endDate) return 0;
  if (challenge.frequency.type === "daily") {
    const days = daysBetweenInclusive(start, challenge.endDate);
    return days - countAwayBetween(start, challenge.endDate, away);
  }
  return weekWindowBounds(challenge).reduce(
    (sum, w) =>
      sum +
      windowRequirement(challenge.frequency.target, w.start, w.end, start, away),
    0
  );
}

/** Away days inside an inclusive span. */
function countAwayBetween(
  from: string,
  to: string,
  away?: ReadonlySet<string>
): number {
  if (!away || away.size === 0) return 0;
  let count = 0;
  for (let ymd = from; ymd <= to; ymd = addDaysYmd(ymd, 1)) {
    if (away.has(ymd)) count++;
  }
  return count;
}

export interface DayEntry {
  ymd: string;
  /**
   * "skipped": declared away in advance, so it was never required — distinct
   * from "missed" in every way that matters, and from "done" too, since
   * nothing was asked and nothing was given.
   */
  state: "done" | "missed" | "today" | "future" | "skipped";
}

/** Per-day history for daily challenges, from a member's own effective start onward. */
export function dailyHistory(
  challenge: Challenge,
  checkinYmds: ReadonlySet<string>,
  today: string,
  memberJoinedDate?: string,
  away?: ReadonlySet<string>
): DayEntry[] {
  const start = effectiveStart(challenge, memberJoinedDate);
  if (start > challenge.endDate) return [];
  const days = daysBetweenInclusive(start, challenge.endDate);
  const entries: DayEntry[] = [];
  for (let i = 0; i < days; i++) {
    const ymd = addDaysYmd(start, i);
    // Away wins over done, deliberately. Every counter on the habit page
    // leaves away days out on both sides — they aren't in the denominator, so
    // letting one into the numerator produces "9 of 8 check-ins". Doing the
    // habit anyway is still recognised where recognition belongs: the streak
    // reads the check-ins directly, so a day kept on holiday keeps the run
    // alive rather than merely not breaking it.
    if (away?.has(ymd)) {
      entries.push({ ymd, state: "skipped" });
    } else if (checkinYmds.has(ymd)) {
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
  /**
   * True when `target` is below the challenge's — they joined mid-window, or
   * were away for part of it. Also what stops such a week earning a spare
   * (lib/badges.ts), which is why one flag covers both causes: neither is a
   * full week kept.
   */
  prorated: boolean;
  /** Days of this window declared away. 7 means the week asked nothing. */
  awayDays: number;
  state: "complete" | "current" | "past-incomplete" | "future" | "skipped";
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
  memberJoinedDate?: string,
  away?: ReadonlySet<string>
): WindowEntry[] {
  const start = effectiveStart(challenge, memberJoinedDate);
  const fullTarget = challenge.frequency.target;
  // Same continuation as habitWeek: the History list on the second cycle of a
  // 4-week habit opens at week 5, not week 1.
  const before = challenge.weeksBefore ?? 0;
  const windows: WindowEntry[] = [];
  weekWindowBounds(challenge).forEach((bounds, w) => {
    if (bounds.end < start) return;
    const target = windowRequirement(
      fullTarget,
      bounds.start,
      bounds.end,
      start,
      away
    );
    const awayDays = countAwayBetween(bounds.start, bounds.end, away);
    // Away days are out of the accounting on both sides — see dailyHistory.
    const count = checkinYmds.filter(
      (d) => d >= bounds.start && d <= bounds.end && !away?.has(d)
    ).length;
    let state: WindowEntry["state"];
    // A week that asked for nothing is neither passed nor failed, and calling
    // it "complete" would put a tick beside a week nobody did anything in.
    if (target === 0 && awayDays > 0) state = "skipped";
    else if (count >= target) state = "complete";
    else if (today > bounds.end) state = "past-incomplete";
    else if (today >= bounds.start) state = "current";
    else state = "future";
    windows.push({
      index: w + 1 + before,
      start: bounds.start,
      end: bounds.end,
      count,
      target,
      prorated: target < fullTarget,
      awayDays,
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
  memberJoinedDate?: string,
  away?: ReadonlySet<string>
): number {
  const start = effectiveStart(challenge, memberJoinedDate);
  if (challenge.frequency.type === "daily") {
    const lastCountable =
      today > challenge.endDate ? challenge.endDate : addDaysYmd(today, -1);
    if (lastCountable < start) return 0;
    const elapsed =
      daysBetweenInclusive(start, lastCountable) -
      countAwayBetween(start, lastCountable, away);
    // Only days that were required: a check-in banked while away is welcome
    // but can't offset a miss on a day that was actually asked for.
    const done = checkinYmds.filter(
      (d) => d >= start && d <= lastCountable && !away?.has(d)
    ).length;
    return Math.max(0, elapsed - done);
  }
  // Every window's `end` is <= challenge.endDate (weeklyWindows' loop bound),
  // so once today > endDate every non-"complete" window is already forced to
  // "past-incomplete" by weeklyWindows' own state logic — a plain
  // "past-incomplete" filter already covers the ended-challenge case. A
  // fully-away window is "skipped" rather than either, so it contributes
  // nothing here without needing its own exclusion.
  return weeklyWindows(challenge, checkinYmds, today, memberJoinedDate, away)
    .filter((w) => w.state === "past-incomplete")
    .reduce((sum, w) => sum + Math.max(0, w.target - w.count), 0);
}

export interface HabitWeekDay {
  ymd: string;
  /** Narrow weekday initial for that actual date — F for a Friday, not a fixed grid. */
  letter: string;
  /**
   * "inactive": inside the window but before this member joined — never a
   * miss. "skipped": declared away in advance — also never a miss, but a
   * decision rather than an accident of when they joined, so it reads
   * differently and is worth showing differently.
   */
  state: "done" | "missed" | "today" | "future" | "inactive" | "skipped";
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
  memberJoinedDate?: string,
  away?: ReadonlySet<string>
): HabitWeek | null {
  const bounds = weekWindowBounds(challenge);
  if (bounds.length === 0) return null;

  let index = bounds.findIndex((w) => today >= w.start && today <= w.end);
  if (index === -1) index = today < challenge.startDate ? 0 : bounds.length - 1;
  const { start, end } = bounds[index];
  // Continues across a repeat rather than restarting: the second cycle of a
  // weekly habit is week 2. See weeksBefore on Challenge.
  const before = challenge.weeksBefore ?? 0;

  const memberStart = effectiveStart(challenge, memberJoinedDate);
  const done = new Set(checkinYmds);
  const days: HabitWeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const ymd = addDaysYmd(start, i);
    const letter = formatYmd(ymd, "EEEEE");
    let state: HabitWeekDay["state"];
    if (ymd < memberStart) state = "inactive";
    else if (away?.has(ymd)) state = "skipped";
    else if (done.has(ymd)) state = "done";
    else if (ymd === today) state = "today";
    else if (ymd < today) state = "missed";
    else state = "future";
    days.push({ ymd, letter, state });
  }

  // Daily habits store frequency.target as 1 (see createChallengeAdmin), so
  // their real requirement is "every day you're a member and not away", not
  // that number.
  const target =
    challenge.frequency.type === "daily"
      ? days.filter((d) => d.state !== "inactive" && d.state !== "skipped").length
      : windowRequirement(
          challenge.frequency.target,
          start,
          end,
          memberStart,
          away
        );

  return {
    index: index + 1 + before,
    totalWeeks: bounds.length + before,
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
  memberJoinedDate?: string,
  away?: ReadonlySet<string>
): ProgressSummary {
  const today = todayYmd(timezone);
  const state = challengeState(challenge, today);
  const inRange = checkinYmds.filter(
    (d) => d >= challenge.startDate && d <= challenge.endDate
  );
  const checkedInToday = inRange.includes(today);
  return {
    // Away days out of the numerator as well as the denominator, or a habit
    // kept through a holiday reports more check-ins than it asked for.
    completed: inRange.filter((d) => !away?.has(d)).length,
    total: totalRequired(challenge, memberJoinedDate, away),
    skipsUsed: skipsUsed(challenge, inRange, today, memberJoinedDate, away),
    daysRemaining:
      state === "active" ? daysBetweenInclusive(today, challenge.endDate) : 0,
    checkedInToday,
    // Checking in on a day you declared off is allowed and counts for the
    // streak; it just isn't required. Blocking it would punish someone for
    // keeping a habit up on holiday.
    canCheckInToday: state === "active" && !checkedInToday,
  };
}
