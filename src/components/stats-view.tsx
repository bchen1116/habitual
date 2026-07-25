"use client";

import { useEffect, useState } from "react";
import { getDocs } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useActiveChallengeCheckins } from "@/hooks/use-active-challenge-checkins";
import { useChallengeHistory } from "@/hooks/use-challenge-history";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { averageAmount, computeLifetimeStats } from "@/lib/challenge-stats";
import { todayYmd } from "@/lib/dates";
import { formatAmount, owedByMeQuery, owedToMeQuery } from "@/lib/ledger";
import { maxLongestStreak } from "@/lib/streak";
import type { LedgerEntry } from "@/lib/types";
import { StatTile } from "@/components/stat-tile";

export function StatsView({ uid }: { uid: string }) {
  const timezone = useUserTimezone(uid);
  const {
    challenges,
    checkinsByChallenge,
    loading,
    error: activeError,
  } = useActiveChallengeCheckins(uid);
  const { entries: history, error: historyError } = useChallengeHistory(uid);
  const [ledger, setLedger] = useState<{ owed: LedgerEntry[]; credits: LedgerEntry[] } | null>(
    null
  );
  const [ledgerError, setLedgerError] = useState(false);
  const today = todayYmd(timezone);

  // One-time reads, matching the challenge history above — this section is
  // a lifetime summary, not something that needs to track live settlement.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getClientDb();
        const [owedSnap, creditSnap] = await Promise.all([
          getDocs(owedByMeQuery(db, uid)),
          getDocs(owedToMeQuery(db, uid)),
        ]);
        if (cancelled) return;
        setLedger({
          owed: owedSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as LedgerEntry),
          credits: creditSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as LedgerEntry),
        });
      } catch (err) {
        // Unguarded, this left `ledger` (and lifetimeLoading below) stuck
        // forever on a fetch failure — the lifetime section spun on its
        // loading skeleton with no way out short of a full page reload.
        console.error("stats ledger fetch failed:", err);
        if (!cancelled) setLedgerError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const activeChallenges = challenges ?? [];
  const checkinYmdsByChallenge = Object.fromEntries(
    Object.entries(checkinsByChallenge).map(([id, records]) => [
      id,
      records.map((r) => r.localDate),
    ])
  );
  const totalCheckIns = Object.values(checkinsByChallenge).reduce(
    (sum, records) => sum + records.length,
    0
  );
  const longestActiveStreak = maxLongestStreak(activeChallenges, checkinYmdsByChallenge, today);

  const lifetime = history ? computeLifetimeStats(history) : null;
  // "Avg. won" only ever reflects pool-mode wins — a charity-mode win pays
  // out nothing to you (the loser's money goes to their charity instead),
  // so it correctly contributes no entry here rather than being a gap.
  const avgWon = ledger ? averageAmount(ledger.credits) : null;
  const avgLost = ledger ? averageAmount(ledger.owed) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-5 lg:p-9">
      <div>
        <h1 className="type-display text-3xl">Progress</h1>
        {loading ? (
          <div className="mt-4 h-24 animate-pulse rounded-2xl bg-muted" />
        ) : activeError ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Couldn&apos;t load your active habits.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3.5">
            <StatTile value={totalCheckIns} label="Total check-ins" />
            <StatTile value={activeChallenges.length} label="Active habits" />
            <StatTile value={longestActiveStreak} label="Longest streak" />
          </div>
        )}
      </div>

      <div>
        <h2 className="type-display text-xl">Lifetime</h2>
        {historyError || ledgerError ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Couldn&apos;t load your challenge history.
          </p>
        ) : !lifetime || !ledger ? (
          // Was `!lifetime || !ledger` gated behind a separate
          // `lifetimeLoading` alias — on a ledgerError, `ledger` never
          // gets set, so that stayed true forever and this section spun
          // on its loading skeleton indefinitely. Checked directly here
          // (ledgerError already handled above) instead.
          <div className="mt-4 h-48 animate-pulse rounded-2xl bg-muted" />
        ) : lifetime.totalCompleted === 0 ? (
          <div className="mt-4 rounded-2xl bg-card px-4 py-6 text-center">
            <p className="font-bold">No completed challenges yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Finish one to start building your lifetime stats.
            </p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3.5">
            <StatTile value={lifetime.totalCompleted} label="Challenges completed" />
            <StatTile
              value={lifetime.winRate !== null ? `${lifetime.winRate}%` : "—"}
              label="Win rate"
            />
            <StatTile
              value={avgWon !== null ? formatAmount(avgWon) : "—"}
              label="Avg. won"
            />
            <StatTile
              value={avgLost !== null ? formatAmount(avgLost) : "—"}
              label="Avg. lost"
            />
            <StatTile value={`${lifetime.bestCompletionPercent}%`} label="Best completion" />
            <StatTile value={formatAmount(lifetime.totalWagered)} label="Total wagered" />
            <StatTile
              value={`${lifetime.soloCount} / ${lifetime.groupCount}`}
              label="Solo / group"
            />
            <StatTile value={lifetime.longestChallengeDays} label="Longest challenge (days)" />
          </div>
        )}
      </div>
    </div>
  );
}
