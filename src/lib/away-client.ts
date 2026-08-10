import type { AwayRange } from "@/lib/types";

/**
 * Booking and un-booking time off.
 *
 * Server-routed rather than a direct Firestore write, and firestore.rules
 * refuses `awayRanges` from clients outright. Time off reduces what a habit
 * asks of you, so the rule that keeps it honest — a range must start strictly
 * after the user's own local today — has to be checked somewhere that knows
 * both their timezone and which element of the array changed. Rules know
 * neither.
 *
 * Neither call is optimistic: the user-document listener only sees the change
 * once the round trip lands, and showing a holiday as booked before the
 * server has agreed would be the one thing worse than a slow spinner here.
 */

export async function addAwayRange(
  start: string,
  end: string,
  label: string | null
): Promise<AwayRange[]> {
  const response = await fetch("/api/account/away", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end, label }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Couldn't book that time off");
  }
  return (body?.ranges as AwayRange[]) ?? [];
}

export async function removeAwayRange(start: string): Promise<AwayRange[]> {
  const response = await fetch("/api/account/away", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Couldn't remove that time off");
  }
  return (body?.ranges as AwayRange[]) ?? [];
}
