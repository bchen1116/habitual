/**
 * What the app can notify you about, and when the daily nudge lands.
 *
 * The category keys mirror NotificationCategory in functions/src/notifications.ts
 * and the hour bounds mirror functions/src/reminders.ts — the Cloud Functions
 * share no package with the Next app, so this is the same deliberate
 * duplication as effectiveStart/windowRequirement. A key that exists on only
 * one side means a toggle that silences nothing, or a notification with no
 * off switch.
 */

export type NotificationCategory =
  | "groupActivity"
  | "challengeLifecycle"
  | "ledger"
  | "dailyReminder";

export const NOTIFICATION_CATEGORIES: {
  key: NotificationCategory;
  label: string;
  description: string;
}[] = [
  {
    key: "dailyReminder",
    label: "Daily check-in reminder",
    description: "One nudge before your day ends, for anything not checked in",
  },
  {
    key: "challengeLifecycle",
    label: "Habit lifecycle",
    description: "Starting today, last-day warnings, results",
  },
  {
    key: "groupActivity",
    label: "Group activity",
    description: "Someone joined a habit you're in",
  },
  {
    key: "ledger",
    label: "Ledger",
    description: "New debts, and settlements owed to you",
  },
];

/**
 * Evening only. The nudge exists because a day is about to close and each
 * habit is about to be fixed as done or missed — an option at 9am would be a
 * different notification, and there already is one.
 */
export const MIN_REMINDER_HOUR = 16;
export const MAX_REMINDER_HOUR = 23;
export const DEFAULT_REMINDER_HOUR = 22;

export const REMINDER_HOURS: number[] = Array.from(
  { length: MAX_REMINDER_HOUR - MIN_REMINDER_HOUR + 1 },
  (_, i) => MIN_REMINDER_HOUR + i
);

export function reminderHourFor(stored: unknown): number {
  return typeof stored === "number" &&
    Number.isInteger(stored) &&
    stored >= MIN_REMINDER_HOUR &&
    stored <= MAX_REMINDER_HOUR
    ? stored
    : DEFAULT_REMINDER_HOUR;
}

/** 22 → "10:00 PM". Their own clock, not a 24-hour one they have to convert. */
export function formatHour(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}
