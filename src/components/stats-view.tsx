"use client";

import { useEffect, useMemo, useState } from "react";
import { getDocs } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { useActivity } from "@/components/activity-provider";
import { useChallengeHistory } from "@/hooks/use-challenge-history";
import { useReflectionHistory } from "@/hooks/use-reflection-history";
import { averageAmount, computeLifetimeStats } from "@/lib/challenge-stats";
import { formatAmount } from "@/lib/currency";
import { owedByMeQuery, owedToMeQuery } from "@/lib/ledger";
import { useMaxChainLongestStreak } from "@/hooks/use-chain-streak";
import type { LedgerEntry } from "@/lib/types";
import { LifetimeRatings } from "@/components/lifetime-ratings-card";
import { StatTile } from "@/components/stat-tile";

export function StatsView({ uid }: { uid: string }) {
  const {
    challenges,
    checkinsByChallenge,
    joinedDateByChallenge,
    loading,
    error: activeError,
    today,
    checkinYmdsByChallenge,
    activeChallenges,
  } = useActivity();
  const {
    entries: history,
    error: historyError,
    errorHint: historyHint,
  } = useChallengeHistory(uid);
  const [ledger, setLedger] = useState<{ owed: LedgerEntry[]; credits: LedgerEntry[] } | null>(
    null
  );
  const [ledgerError, setLedgerError] = useState(false);

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

  // Collapsed to one entry per habit and stripped of anything already past
  // its end date, so "Active habits" counts habits rather than challenge
  // documents (lib/cycles.ts). totalCheckIns below deliberately still sums
  // over everything — that one is a lifetime figure.
  const totalCheckIns = Object.values(checkinsByChallenge).reduce(
    (sum, records) => sum + records.length,
    0
  );
  // Chain-aware: a repeated habit's best-ever run spans its earlier cycles
  // rather than restarting with each one. Per-cycle, a 30-day run across three
  // 2-week cycles reported 14 — and the leaderboard, which has always walked
  // the chain, would have ranked the same person on 30.
  const { best: longestActiveStreak, pending: longestPending } =
    useMaxChainLongestStreak(
      activeChallenges,
      uid,
      checkinYmdsByChallenge,
      today,
      joinedDateByChallenge
    );

  // Ratings span everything the user has ever run, not just what's live — the
  // whole point of the section is the long view. Held until both sources have
  // landed so the fetch below runs once against the full set rather than
  // firing again the moment history arrives.
  //
  // A source that *failed*, though, is never going to land. Waiting on it left
  // this stuck at null forever, which the section renders as a permanent
  // loading skeleton — so one failed query took down a second, unrelated
  // section that had everything it needed.
  const ratedHabits = useMemo(() => {
    if (challenges === null && !activeError) return null;
    if (history === null && !historyError) return null;
    return [
      ...(challenges ?? []).map((c) => ({ id: c.id, name: c.name })),
      ...(history ?? []).map((h) => ({ id: h.challenge.id, name: h.challenge.name })),
    ];
  }, [challenges, history, activeError, historyError]);
  const {
    habits: reflectionHabits,
    error: reflectionError,
    errorHint: reflectionHint,
  } = useReflectionHistory(uid, ratedHabits);

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
            <StatTile
              value={longestPending ? "—" : longestActiveStreak}
              label="Longest streak"
            />
          </div>
        )}
      </div>

      {/* Only a reflections failure, or losing *both* habit sources, means the
          ratings genuinely can't be shown. Previously any one of the three
          failing blanked this section, so a broken lifetime query also erased
          the ratings for habits that had loaded perfectly well. */}
      <LifetimeRatings
        habits={reflectionHabits}
        error={reflectionError || (activeError && historyError)}
        errorHint={reflectionHint}
      />

      <div>
        <h2 className="type-display text-xl">Lifetime</h2>
        {historyError || ledgerError ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Couldn&apos;t load your challenge history.
            {historyHint && ` ${historyHint}`}
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
