/**
 * yyyymmdd helpers, duplicated from the web app's src/lib/dates.ts —
 * the functions workspace is a separate package and these are small,
 * pure, and stable. Keep the two in sync if semantics ever change.
 */

/** Parse yyyymmdd to a Date pinned to noon UTC (immune to DST edges). */
function ymdToDate(ymd: string): Date {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day = Number(ymd.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function dateToYmdUTC(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const date = ymdToDate(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToYmdUTC(date);
}

/** Inclusive day count between two yyyymmdd dates (a <= b). */
export function daysBetweenInclusive(a: string, b: string): number {
  const ms = ymdToDate(b).getTime() - ymdToDate(a).getTime();
  return Math.round(ms / 86_400_000) + 1;
}
