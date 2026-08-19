import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";

/**
 * The current Venmo handle of whoever a debt is owed to.
 *
 * `toVenmoUsername` is stamped onto the ledger entry at adjudication, which
 * fixes the handle to whatever the winner happened to have at the moment the
 * debt was created. That is the wrong moment. The realistic sequence is: the
 * cycle is graded, the loser opens the debt to pay it, finds no link, asks
 * "where do I send this?", and only then does the winner add their handle —
 * by which point the entry has been frozen for days and no link will ever
 * appear on it. The one case the stored copy cannot serve is the one that
 * actually happens.
 *
 * So the entry keeps its stamp as a fallback and this resolves the live
 * value on read. The debtor cannot do it themselves: users/{uid} is
 * owner-only in the rules, which is why this exists server-side at all.
 *
 * **Only the debtor, and only the handle.** Someone who owes this entry is
 * exactly the person the handle was published for; anyone else — including
 * the creditor asking about their own debt — gets nothing. The response
 * carries a Venmo username and no other field of that user's profile.
 */
export class LedgerPayeeError extends Error {
  constructor(public code: "not-found" | "not-debtor") {
    super(code);
  }
}

export async function ledgerPayeeVenmoAdmin(
  callerUid: string,
  entryId: string
): Promise<{ venmoUsername: string | null }> {
  const db = getAdminDb();
  const snap = await db.collection("ledgerEntries").doc(entryId).get();
  if (!snap.exists) throw new LedgerPayeeError("not-found");

  const entry = snap.data()!;
  if (entry.fromUid !== callerUid) throw new LedgerPayeeError("not-debtor");

  // A charity forfeit has no payee to look up, and a settled debt has nothing
  // left to pay — neither should cause a read of anyone's profile.
  if (entry.toType !== "user" || !entry.toUid || entry.status !== "unsettled") {
    return { venmoUsername: null };
  }

  const payee = await db.collection("users").doc(entry.toUid).get();
  const live = (payee.data()?.venmoUsername as string | undefined) ?? null;
  // The stored copy still counts for something: if the winner has since
  // cleared their handle, the debt was created against one, and falling back
  // to it would resurrect a link they deliberately took down. Live wins, and
  // the stamp only fills in when the profile read found nothing at all —
  // which is a missing user doc, not an emptied field.
  return { venmoUsername: live ?? (payee.exists ? null : entry.toVenmoUsername ?? null) };
}
