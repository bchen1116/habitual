"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { formatAmount, owedByMeQuery, owedToMeQuery } from "@/lib/ledger";
import type { LedgerEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Tab = "owe" | "owed";
type Filter = "all" | "unsettled" | "settled";

function counterpartyName(entry: LedgerEntry, tab: Tab): string {
  if (tab === "owe") {
    return entry.toType === "charity"
      ? (entry.toCharityName ?? "Charity")
      : (entry.toName ?? "Someone");
  }
  return entry.fromName;
}

export function LedgerList({ uid, initialTab }: { uid: string; initialTab: Tab }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [filter, setFilter] = useState<Filter>("all");
  const [owedByMe, setOwedByMe] = useState<LedgerEntry[] | null>(null);
  const [owedToMe, setOwedToMe] = useState<LedgerEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const db = getClientDb();
    const onError = (err: unknown) => {
      console.error("ledger query failed:", err);
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

  function switchTab(next: Tab) {
    setTab(next);
    router.replace(`/ledger?tab=${next}`, { scroll: false });
  }

  const entries = tab === "owe" ? owedByMe : owedToMe;

  const filtered = useMemo(() => {
    if (!entries) return null;
    const byFilter =
      filter === "all" ? entries : entries.filter((e) => e.status === filter);
    return [...byFilter].sort((a, b) => {
      if (a.status !== b.status) return a.status === "unsettled" ? -1 : 1;
      return (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0);
    });
  }, [entries, filter]);

  const unsettledTotal = useMemo(
    () =>
      (entries ?? [])
        .filter((e) => e.status === "unsettled")
        .reduce((sum, e) => sum + e.amount, 0),
    [entries]
  );

  const grouped = useMemo(() => {
    if (!filtered) return null;
    const map = new Map<string, LedgerEntry[]>();
    for (const entry of filtered) {
      const key = counterpartyName(entry, tab);
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return [...map.entries()];
  }, [filtered, tab]);

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Couldn&apos;t load your ledger</CardTitle>
          <CardDescription>
            Check your connection and try refreshing the page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button
          variant={tab === "owe" ? "default" : "outline"}
          size="sm"
          onClick={() => switchTab("owe")}
        >
          I owe
        </Button>
        <Button
          variant={tab === "owed" ? "default" : "outline"}
          size="sm"
          onClick={() => switchTab("owed")}
        >
          I&apos;m owed
        </Button>
      </div>

      <div className="flex gap-2">
        {(["all", "unsettled", "settled"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              "rounded-full px-3 py-1 text-xs transition-colors " +
              (filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/70")
            }
          >
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {unsettledTotal > 0 && (
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {formatAmount(unsettledTotal)}
          </span>{" "}
          unsettled
        </p>
      )}

      {filtered === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {tab === "owe" ? "No debts here" : "No one owes you right now"}
            </CardTitle>
            <CardDescription>
              {tab === "owe"
                ? filter === "all"
                  ? "No debts yet — nice."
                  : "Nothing matches this filter."
                : "Debts owed to you appear when group challenges arrive."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        grouped!.map(([name, items]) => (
          <div key={name} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">{name}</h3>
              <span className="text-xs text-muted-foreground">
                {formatAmount(
                  items
                    .filter((e) => e.status === "unsettled")
                    .reduce((s, e) => s + e.amount, 0)
                )}{" "}
                unsettled
              </span>
            </div>
            {items.map((entry) => (
              <Link key={entry.id} href={`/ledger/${entry.id}`}>
                <Card className="transition-colors hover:bg-accent">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {entry.challengeName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatAmount(entry.amount)}
                      </span>
                    </div>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-xs " +
                        (entry.status === "unsettled"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-secondary text-secondary-foreground")
                      }
                    >
                      {entry.status === "unsettled" ? "Unsettled" : "Settled"}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
