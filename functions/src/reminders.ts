import { addDaysYmd, daysBetweenInclusive } from "./dates";
import { windowDaysAvailable, windowRequirement } from "./adjudicate";

/**
 * "Anything still unchecked before your day ends" — the evening nudge.
 *
 * Pure so it can be reasoned about without a Firestore emulator, and so the
 * one thing that must not drift — what a week actually asks of you — comes
 * from the same windowRequirement adjudication uses rather than a second
 * opinion. Nagging someone for a check-in the money layer doesn't want is
 * how a reminder earns itself a permanent "off".
 */

export interface ReminderChallenge {
  id: string;
  name: string;
  frequency: { type: "daily" | "weekly_count"; target: number };
  startDate: string;
  endDate: string;
}

/**
 * The 7-day window containing `today`, on the habit's own grid (anchored to
 * startDate, whole-week durations enforced at creation). Null when today is
 * outside the habit's run.
 */
export function currentWindow(
  challenge: ReminderChallenge,
  today: string
): { start: string; end: string } | null {
  if (today < challenge.startDate || today > challenge.endDate) return null;
  const offset = daysBetweenInclusive(challenge.startDate, today) - 1;
  const start = addDaysYmd(challenge.startDate, Math.floor(offset / 7) * 7);
  return { start, end: addDaysYmd(start, 6) };
}

export interface ReminderVerdict {
  /** Whether this habit still wants a check-in from this member today. */
  needed: boolean;
  /**
   * Whether skipping today costs them the week. True for every unchecked day
   * of a daily habit, and for an N×/week habit only once the days left equal
   * the check-ins still owed — before that, tonight is genuinely optional and
   * saying otherwise would be a lie the app gets caught in.
   */
  urgent: boolean;
}

const NOT_NEEDED: ReminderVerdict = { needed: false, urgent: false };

/**
 * `checkinYmds` must cover at least the current window for this member; days
 * outside it are ignored, so passing more is harmless.
 */
export function needsCheckinToday(
  challenge: ReminderChallenge,
  memberJoinedDate: string | undefined,
  today: string,
  checkinYmds: readonly string[],
  /** Days declared off — nothing is asked of them, so nothing is nudged. */
  away?: ReadonlySet<string>
): ReminderVerdict {
  const window = currentWindow(challenge, today);
  if (!window) return NOT_NEEDED;
  if (checkinYmds.includes(today)) return NOT_NEEDED;

  // Someone who joined later today hasn't missed anything yet, but the day is
  // still theirs to use.
  const memberStart =
    memberJoinedDate && memberJoinedDate > challenge.startDate
      ? memberJoinedDate
      : challenge.startDate;
  if (today < memberStart) return NOT_NEEDED;
  // Being reminded to keep a habit on a day you told the app you'd be away is
  // the fastest way to get every notification switched off.
  if (away?.has(today)) return NOT_NEEDED;

  if (challenge.frequency.type === "daily") {
    return { needed: true, urgent: true };
  }

  const required = windowRequirement(
    challenge.frequency.target,
    window.start,
    window.end,
    memberStart,
    away
  );
  const done = checkinYmds.filter(
    (d) => d >= window.start && d <= window.end && !away?.has(d)
  ).length;
  const remaining = required - done;
  if (remaining <= 0) return NOT_NEEDED;

  // Days still available, not calendar days: on a 3×/week week with two days
  // left and one of them away, one remaining check-in is urgent, not routine.
  const daysLeft = windowDaysAvailable(today, window.end, memberStart, away);
  return { needed: true, urgent: remaining >= daysLeft };
}

/**
 * One push for the whole evening rather than one per habit: three separate
 * buzzes at 10pm is how someone turns the category off entirely, and the
 * thing they need to know — that something is outstanding — is the same in
 * all three.
 */
export function reminderContent(
  habits: readonly { name: string; urgent: boolean }[]
): { title: string; body: string } | null {
  if (habits.length === 0) return null;

  const urgent = habits.filter((h) => h.urgent);
  const names = habits.map((h) => h.name);

  if (habits.length === 1) {
    return {
      title: urgent.length > 0 ? "Last chance today" : "Still on today's list",
      body:
        urgent.length > 0
          ? `"${names[0]}" needs a check-in before the day's out.`
          : `"${names[0]}" hasn't been checked in yet — still time.`,
    };
  }

  const listed =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

  return {
    title: urgent.length > 0 ? "Last chance today" : "Still on today's list",
    body:
      urgent.length > 0
        ? `${listed} — ${urgent.length} of them can't wait for tomorrow.`
        : `${listed} haven't been checked in yet.`,
  };
}

/** Evening only: the whole point is "before your day ends". */
export const MIN_REMINDER_HOUR = 16;
export const MAX_REMINDER_HOUR = 23;
export const DEFAULT_REMINDER_HOUR = 22;

/**
 * The hour this user wants their nudge, clamped to the evening. A stored
 * value outside the range (an older client, or a hand-edited doc) falls back
 * to the default rather than silently never matching.
 */
export function reminderHourFor(stored: unknown): number {
  return typeof stored === "number" &&
    Number.isInteger(stored) &&
    stored >= MIN_REMINDER_HOUR &&
    stored <= MAX_REMINDER_HOUR
    ? stored
    : DEFAULT_REMINDER_HOUR;
}
