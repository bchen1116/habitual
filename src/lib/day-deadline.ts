import { fromZonedTime } from "date-fns-tz";
import { DAY_CUTOFF_HOUR, addDaysYmd, todayYmd } from "@/lib/dates";

/**
 * How long before the deadline the countdown appears. Six hours puts it on
 * screen at 9pm for the 3am rollover — late enough that it's about tonight
 * rather than about the day in general, early enough to still act on.
 */
const COUNTDOWN_LEAD_HOURS = 6;
export const COUNTDOWN_LEAD_MS = COUNTDOWN_LEAD_HOURS * 60 * 60 * 1000;

/**
 * The instant the habit day in progress stops accepting check-ins.
 *
 * That is 03:00 local, not midnight — see DAY_CUTOFF_HOUR. The distinction is
 * the whole reason this is worth a function: a countdown to midnight would
 * tell someone at 00:30 that they had missed a day they can still log, which
 * is exactly the wrong answer at exactly the moment it matters most.
 *
 * Built by asking `todayYmd` which habit day is in progress and taking the
 * cutoff on the following calendar date, so the two can't disagree about
 * where the boundary is. Resolved through `fromZonedTime` rather than by
 * adding milliseconds, so the two nights a year that are 23 or 25 hours long
 * count correctly.
 */
export function nextDayCutoff(timezone: string, now: Date = new Date()): Date {
  const deadlineYmd = addDaysYmd(todayYmd(timezone, now), 1);
  const hh = String(DAY_CUTOFF_HOUR).padStart(2, "0");
  const iso = `${deadlineYmd.slice(0, 4)}-${deadlineYmd.slice(4, 6)}-${deadlineYmd.slice(
    6,
    8
  )}T${hh}:00:00`;
  return fromZonedTime(iso, timezone);
}

/** Milliseconds until the current habit day's cutoff. Always positive. */
export function msUntilDayCutoff(timezone: string, now: Date = new Date()): number {
  return nextDayCutoff(timezone, now).getTime() - now.getTime();
}

/**
 * Remaining time, in the coarsest unit that still reads as urgent.
 *
 * Hours and minutes above an hour, minutes and seconds below it. The switch
 * is deliberate: a ticking seconds display is noise when there are four hours
 * left and the point when there are four minutes, and "0h 4m" understates
 * both how little is left and how fast it's going.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
