import { formatInTimeZone } from "date-fns-tz";

/**
 * All challenge dates are `yyyymmdd` strings (see docs/02): they sort
 * chronologically as strings, match the check-in doc-ID format, and each
 * member interprets them in their own timezone.
 */

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * The hour a habit day rolls over, local to the user. Not midnight, because
 * midnight is in the middle of many people's evening: at 1am you have not
 * been to bed, so "today's" run is still the run you owe, and being told you
 * missed it while you are still awake to do it is simply wrong. Anything
 * logged before this hour counts for the previous calendar date; the next
 * day's habit begins at 03:00.
 */
export const DAY_CUTOFF_HOUR = 3;

/**
 * The habit date in the given IANA timezone, as yyyymmdd — the calendar date
 * shifted back by DAY_CUTOFF_HOUR, so 00:00–02:59 still belongs to the day
 * before.
 *
 * Subtracting real elapsed time rather than manipulating the calendar is
 * deliberate: across a DST boundary "three hours ago" is what the rule
 * actually means, and it's what someone still awake experiences.
 *
 * `now` is injectable so the boundary can be tested at a specific instant
 * instead of only whenever the suite happens to run.
 */
export function todayYmd(timezone: string, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - DAY_CUTOFF_HOUR * 60 * 60 * 1000);
  return formatInTimeZone(shifted, timezone, "yyyyMMdd");
}

/**
 * "day ends 3am EST" — which clock a habit day actually runs on.
 *
 * Worth stating because the answer is not "yours". A user's timezone is
 * frozen while they have an active habit (ensureUserDoc), so someone who
 * travels keeps their old day boundary — and twelve hours out that boundary
 * lands in the middle of the local afternoon, where two sessions on
 * consecutive local mornings can both fall on the same habit day and one
 * habit day can pass unnoticed. Naming the zone is the cheapest thing that
 * makes that visible instead of baffling.
 *
 * `zzz` gives a real abbreviation where one exists (EST, PDT) and an honest
 * offset where it doesn't (GMT+13), and it tracks daylight saving because it
 * is resolved against `now` rather than looked up in a table.
 */
export function dayEndsLabel(timezone: string, now: Date = new Date()): string {
  const hour = DAY_CUTOFF_HOUR % 12 || 12;
  const meridiem = DAY_CUTOFF_HOUR < 12 ? "am" : "pm";
  return `day ends ${hour}${meridiem} ${formatInTimeZone(now, timezone, "zzz")}`;
}

/**
 * True between midnight and the cutoff, when the habit date on screen is
 * yesterday's. Worth saying out loud — otherwise a check-in at 1am looks like
 * it landed on the wrong day.
 */
export function isBeforeDayCutoff(timezone: string, now: Date = new Date()): boolean {
  return Number(formatInTimeZone(now, timezone, "H")) < DAY_CUTOFF_HOUR;
}

/** Parse yyyymmdd to a Date pinned to noon UTC (immune to DST edges). */
export function ymdToDate(ymd: string): Date {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day = Number(ymd.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function addDaysYmd(ymd: string, days: number): string {
  const date = ymdToDate(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return formatInTimeZone(date, "UTC", "yyyyMMdd");
}

/** Inclusive day count between two yyyymmdd dates (a <= b). */
export function daysBetweenInclusive(a: string, b: string): number {
  const ms = ymdToDate(b).getTime() - ymdToDate(a).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Human-readable form of a yyyymmdd date, e.g. "Jul 23". */
export function formatYmd(ymd: string, pattern = "MMM d"): string {
  return formatInTimeZone(ymdToDate(ymd), "UTC", pattern);
}

/** yyyy-mm-dd (native date-input value) → yyyymmdd. */
export function dateInputToYmd(value: string): string {
  return value.replaceAll("-", "");
}

/** yyyymmdd → yyyy-mm-dd for native date inputs. */
export function ymdToDateInput(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}
