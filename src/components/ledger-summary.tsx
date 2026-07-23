"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { formatAmount, owedByMeQuery, owedToMeQuery } from "@/lib/ledger";
import type { LedgerEntry } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";

/** Dashboard card: unsettled totals in both directions. */
export function LedgerSummary({ uid }: { uid: string }) {
  const [owedByMe, setOwedByMe] = useState<LedgerEntry[] | null>(null);
  const [owedToMe, setOwedToMe] = useState<LedgerEntry[] | null>(null);

  useEffect(() => {
    const db = getClientDb();
    const unsubscribeFrom = onSnapshot(owedByMeQuery(db, uid), (snap) =>
      setOwedByMe(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LedgerEntry))
    );
    const unsubscribeTo = onSnapshot(owedToMeQuery(db, uid), (snap) =>
      setOwedToMe(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LedgerEntry))
    );
    return () => {
      unsubscribeFrom();
      unsubscribeTo();
    };
  }, [uid]);

  if (owedByMe === null || owedToMe === null) {
    return <div className="h-16 animate-pulse rounded-xl bg-muted" />;
  }

  const debts = owedByMe.filter((e) => e.status === "unsettled");
  const credits = owedToMe.filter((e) => e.status === "unsettled");
  const debtTotal = debts.reduce((sum, e) => sum + e.amount, 0);
  const creditTotal = credits.reduce((sum, e) => sum + e.amount, 0);

  if (debts.length === 0 && credits.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          You&apos;re all settled 🎉
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4 text-sm">
        {debts.length > 0 && (
          <Link href="/ledger?tab=owe" className="hover:underline">
            You owe <span className="font-semibold">{formatAmount(debtTotal)}</span>{" "}
            across {debts.length} debt{debts.length === 1 ? "" : "s"}
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
