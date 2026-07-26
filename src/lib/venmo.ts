/**
 * A Venmo "pay" deep link (https://developer.venmo.com/docs/deeplinks) —
 * the https://venmo.com/ form rather than the venmo:// scheme so it works
 * everywhere: opens the Venmo app on a phone that has it installed, and
 * falls back to venmo.com in a normal browser. This only ever pre-fills a
 * payment for the user to review and send themselves — Habitual has no
 * Venmo API integration and never touches the money.
 */
export function venmoPayUrl(venmoUsername: string, amount: number, note: string): string {
  const params = new URLSearchParams({
    txn: "pay",
    recipients: normalizeVenmoUsername(venmoUsername),
    amount: amount.toFixed(2),
    note,
  });
  return `https://venmo.com/?${params.toString()}`;
}

/** Strips an optional leading "@" some users type out of habit. */
export function normalizeVenmoUsername(input: string): string {
  return input.trim().replace(/^@/, "");
}
