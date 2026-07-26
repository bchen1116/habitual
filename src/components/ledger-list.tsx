"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { formatAmount } from "@/lib/currency";
import { owedByMeQuery, owedToMeQuery } from "@/lib/ledger";
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

interface CounterpartyLabel {
  name: string;
  username: string | null;
  isUser: boolean; // vs. charity
}

/**
 * Groups by actual identity (uid, or charity name), not by display-name
 * text — two different people who happen to share a display name must not
 * be merged into one group. This is the same disambiguation problem
 * usernames solve in group member lists.
 */
function counterpartyKey(entry: LedgerEntry, tab: Tab): string {
  if (tab === "owe") {
    return entry.toType === "charity"
      ? `charity:${entry.toCharityName ?? "Charity"}`
      : `user:${entry.toUid ?? "unknown"}`;
  }
  return `user:${entry.fromUid}`;
}

function counterpartyLabel(entry: LedgerEntry, tab: Tab): CounterpartyLabel {
  if (tab === "owe") {
    if (entry.toType === "charity") {
      return { name: entry.toCharityName ?? "Charity", username: null, isUser: false };
    }
    return {
      name: entry.toName ?? "Someone",
      username: entry.toUsername ?? null,
      isUser: true,
    };
  }
  return { name: entry.fromName, username: entry.fromUsername ?? null, isUser: true };
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
    const map = new Map<string, { label: CounterpartyLabel; items: LedgerEntry[] }>();
    for (const entry of filtered) {
      const key = counterpartyKey(entry, tab);
      const existing = map.get(key);
      if (existing) existing.items.push(entry);
      else map.set(key, { label: counterpartyLabel(entry, tab), items: [entry] });
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
              "type-overline rounded-full px-3 py-1 text-[11px] transition-colors " +
              (filter === f
                ? "bg-foreground text-background"
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
        grouped!.map(([key, { label, items }]) => (
          <div key={key} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {label.isUser && (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-bold text-primary">
                    {label.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
                <div className="flex items-baseline gap-1.5">
                  <h3 className="text-sm font-semibold">{label.name}</h3>
                  {label.username && (
                    <span className="text-xs text-muted-foreground">
                      @{label.username}
                    </span>
                  )}
                </div>
              </div>
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
                        "type-overline rounded-full px-2.5 py-1 text-[11px] " +
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
