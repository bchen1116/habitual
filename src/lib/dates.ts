import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

/**
 * All challenge dates are `yyyymmdd` strings (see docs/02): they sort
 * chronologically as strings, match the check-in doc-ID format, and each
 * member interprets them in their own timezone.
 */

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Today's calendar date in the given IANA timezone, as yyyymmdd. */
export function todayYmd(timezone: string): string {
  return formatInTimeZone(new Date(), timezone, "yyyyMMdd");
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

/** Today as a native date-input value in the given timezone. */
export function todayDateInput(timezone: string): string {
  return format(ymdToDate(todayYmd(timezone)), "yyyy-MM-dd");
}
