import { NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/session";
import {
  LedgerPayeeError,
  ledgerPayeeVenmoAdmin,
} from "@/lib/server/ledger-payee";

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Entry not found." },
  "not-debtor": { status: 403, message: "That isn't your debt to pay." },
};

/**
 * Where to send the money for one debt — the payee's current Venmo handle.
 *
 * Read live rather than taken from the entry, because the entry's copy was
 * frozen at grading and the handle is usually added afterwards. See
 * lib/server/ledger-payee.ts for the scoping.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getVerifiedUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  try {
    return NextResponse.json(await ledgerPayeeVenmoAdmin(user.uid, id));
  } catch (err) {
    if (err instanceof LedgerPayeeError) {
      const mapped = ERROR_RESPONSES[err.code];
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
    console.error("ledgerPayeeVenmo failed:", err);
    return NextResponse.json(
      { error: "Couldn't look that up." },
      { status: 500 }
    );
  }
}
