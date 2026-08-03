"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { formatAmount } from "@/lib/currency";
import { owedByMeQuery, owedToMeQuery } from "@/lib/ledger";
import type { LedgerEntry } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Unsettled totals in both directions, on the Habits page.
 *
 * Renders nothing at all unless money is actually outstanding — no "all
 * settled" card, and no loading skeleton either. It used to sit on Today and
 * congratulate you every morning for owing nobody anything, which is the
 * normal state: a permanent fixture reporting the absence of a problem, in the
 * most valuable space in the app. As a card that appears only when there's a
 * debt, its presence is the whole message, and it can't be tuned out.
 */
export function LedgerSummary({ uid }: { uid: string }) {
  const [owedByMe, setOwedByMe] = useState<LedgerEntry[] | null>(null);
  const [owedToMe, setOwedToMe] = useState<LedgerEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const db = getClientDb();
    const onError = (err: unknown) => {
      console.error("ledger summary query failed:", err);
      setLoadError(true);
    };
    const unsubscribeFrom = onSnapshot(
      owedByMeQuery(db, uid),
      (snap) =>
        setOwedByMe(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LedgerEntry)
        ),
      onError
    );
    const unsubscribeTo = onSnapshot(
      owedToMeQuery(db, uid),
      (snap) =>
        setOwedToMe(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LedgerEntry)
        ),
      onError
    );
    return () => {
      unsubscribeFrom();
      unsubscribeTo();
    };
  }, [uid]);

  // On error, render nothing rather than spin forever or wrongly imply
  // there's nothing owed.
  if (loadError) return null;

  // No skeleton while loading: having nothing outstanding is the common case,
  // so a placeholder would usually be reserving space for a card that never
  // arrives — and the page above it would visibly jump when it didn't.
  if (owedByMe === null || owedToMe === null) return null;

  const debts = owedByMe.filter((e) => e.status === "unsettled");
  const credits = owedToMe.filter((e) => e.status === "unsettled");
  const debtTotal = debts.reduce((sum, e) => sum + e.amount, 0);
  const creditTotal = credits.reduce((sum, e) => sum + e.amount, 0);

  if (debts.length === 0 && credits.length === 0) return null;

  const toPeople = debts
    .filter((e) => e.toType === "user")
    .reduce((sum, e) => sum + e.amount, 0);
  const toCharities = debtTotal - toPeople;
  const breakdown =
    toPeople > 0 && toCharities > 0
      ? ` (${formatAmount(toPeople)} to people, ${formatAmount(toCharities)} to charities)`
      : "";

  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4 text-sm">
        {debts.length > 0 && (
          <Link href="/ledger?tab=owe" className="hover:underline">
            You owe <span className="font-semibold">{formatAmount(debtTotal)}</span>{" "}
            across {debts.length} debt{debts.length === 1 ? "" : "s"}
            {breakdown}
          </Link>
        )}
        {credits.length > 0 && (
          <Link href="/ledger?tab=owed" className="hover:underline">
            You&apos;re owed{" "}
            <span className="font-semibold">{formatAmount(creditTotal)}</span>
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
