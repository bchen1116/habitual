"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { GooeyLoader } from "@/components/ui/loader-10";
import { cacheGet, cacheSet } from "@/lib/client-cache";
import { browserTimezone, todayYmd } from "@/lib/dates";
import { cn } from "@/lib/utils";

interface LeaderboardEntry {
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  currentStreak: number;
  currentStreakWeeks: number;
  longestStreak: number;
  badges: number;
  isSelf: boolean;
}

type SortKey = "currentStreak" | "longestStreak";

const PODIUM_SIZE = 3;

/**
 * Ranking of everyone you've shared a habit with, above the habits list.
 *
 * Ink panel rather than a light card on purpose: the Habits page's check-in
 * buttons already spend the design system's one-volt-element-per-screen
 * budget, so rank pills here stay monochrome and the panel matches the
 * existing ink chrome (week-strip, streak-hero).
 */
interface LeaderboardBody {
  entries: LeaderboardEntry[];
  viewerHidden: boolean;
}

/**
 * The day belongs in the key because a current streak decays with the
 * calendar: nobody has to write anything for yesterday's board to be wrong
 * today. Computed per render rather than once at module load — a tab left open
 * overnight would otherwise keep serving the previous day's ranking, and the
 * one thing this cache must never do is outlive the truth of what it holds.
 */
function cacheKeyForToday(): string {
  return `leaderboard:${todayYmd(browserTimezone())}`;
}

export function LeaderboardCard() {
  const cacheKey = cacheKeyForToday();
  const cached = cacheGet<LeaderboardBody>(cacheKey);
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(
    cached?.entries ?? null
  );
  const [viewerHidden, setViewerHidden] = useState(cached?.viewerHidden ?? false);
  const [error, setError] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("currentStreak");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const key = cacheKeyForToday();
    const hadCache = cacheGet<LeaderboardBody>(key) !== undefined;

    // Stale-while-revalidate. The board is the most expensive thing on the
    // page — the server recomputes streaks for every peer — so a cached copy
    // renders immediately and the refresh lands underneath it. Coming back to
    // this page therefore costs nothing visible, and nothing is ever shown
    // that wasn't true when it was computed.
    fetch("/api/leaderboard")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as LeaderboardBody;
      })
      .then((body) => {
        cacheSet(key, body);
        if (cancelled) return;
        setEntries(body.entries);
        setViewerHidden(Boolean(body.viewerHidden));
        setError(false);
      })
      .catch((err) => {
        if (cancelled) return;
        // Distinct from "no peers" below — conflating a failed fetch with an
        // empty result is a bug this codebase has already had once.
        console.error("leaderboard fetch failed:", err);
        // A cached board stays on screen: it was correct when it was computed,
        // and showing it beats replacing something true with an error.
        if (!hadCache) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Panel>
        <p className="text-sm text-white">Couldn&apos;t load the leaderboard.</p>
        <p className="mt-1 text-sm text-ink-label">
          Check your connection and try refreshing the page.
        </p>
      </Panel>
    );
  }

  // Rendered inside the same ink panel the loaded board uses, so the card
  // doesn't change shape or colour when the data lands — the leaderboard is
  // server-computed (streaks for every peer), so this is on screen long
  // enough to be worth looking at rather than a bare grey block.
  if (entries === null) {
    return (
      <Panel>
        <span className="type-overline text-xs text-primary">Leaderboard</span>
        <div className="flex items-center justify-center py-4">
          <GooeyLoader label="Working out the leaderboard" />
        </div>
      </Panel>
    );
  }

  // Everyone's alone on their own board until they do a habit with someone.
  if (entries.length <= 1) {
    return (
      <Panel>
        <p className="text-sm text-white">No one to rank yet.</p>
        <p className="mt-1 text-sm text-ink-label">
          Start a group habit with a friend and you&apos;ll both show up here.
        </p>
        <HiddenNote hidden={viewerHidden} />
      </Panel>
    );
  }

  const ranked = [...entries].sort(
    (a, b) =>
      b[sortKey] - a[sortKey] ||
      b.currentStreak - a.currentStreak ||
      a.displayName.localeCompare(b.displayName)
  );
  const selfIndex = ranked.findIndex((e) => e.isSelf);
  const visible = expanded ? ranked : ranked.slice(0, PODIUM_SIZE);
  // Keep your own standing on screen even when you're off the podium.
  const selfBelowFold =
    !expanded && selfIndex >= PODIUM_SIZE ? ranked[selfIndex] : null;

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3">
        <span className="type-overline text-xs text-primary">Leaderboard</span>
        <div className="flex gap-1">
          <SortButton
            active={sortKey === "currentStreak"}
            onClick={() => setSortKey("currentStreak")}
          >
            Current
          </SortButton>
          <SortButton
            active={sortKey === "longestStreak"}
            onClick={() => setSortKey("longestStreak")}
          >
            All-time
          </SortButton>
        </div>
      </div>

      <ol className="mt-4 flex flex-col gap-2.5">
        {visible.map((entry, i) => (
          <Row
            key={entry.uid}
            entry={entry}
            rank={i + 1}
            value={entry[sortKey]}
            weeks={sortKey === "currentStreak" ? entry.currentStreakWeeks : null}
          />
        ))}
      </ol>

      {selfBelowFold && (
        <div className="mt-2.5 border-t border-ink-bar-empty pt-2.5">
          <Row
            entry={selfBelowFold}
            rank={selfIndex + 1}
            value={selfBelowFold[sortKey]}
            weeks={sortKey === "currentStreak" ? selfBelowFold.currentStreakWeeks : null}
          />
        </div>
      )}

      {ranked.length > PODIUM_SIZE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="type-overline mt-3.5 text-[11px] text-ink-nav-inactive transition-colors hover:text-white"
        >
          {expanded ? "Show less" : `See all ${ranked.length}`}
        </button>
      )}

      <HiddenNote hidden={viewerHidden} />
    </Panel>
  );
}

/**
 * Without this, opting out is invisible from the one screen where it matters:
 * you'd still see yourself ranked here and have no way to tell that nobody
 * else does.
 */
function HiddenNote({ hidden }: { hidden: boolean }) {
  if (!hidden) return null;
  return (
    <p className="mt-3.5 border-t border-ink-bar-empty pt-3 text-xs text-ink-label">
      You&apos;re hidden from other people&apos;s leaderboards. You can still
      see yours. Change this in Settings.
    </p>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[20px] bg-ink px-5 py-[18px]">{children}</div>;
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "type-overline rounded-full px-2.5 py-1 text-[11px] transition-colors",
        active ? "bg-white text-ink" : "text-ink-nav-inactive hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function Row({
  entry,
  rank,
  value,
  weeks,
}: {
  entry: LeaderboardEntry;
  rank: number;
  value: number;
  /** Null in all-time mode: the span we track belongs to the CURRENT run, so
   *  pairing it with an all-time figure would caption the wrong streak. */
  weeks: number | null;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          "type-display w-5 shrink-0 text-base",
          entry.isSelf ? "text-primary" : "text-ink-label"
        )}
      >
        {rank}
      </span>
      {/* Avatar's own bg-ink would vanish into this ink panel, and its volt
          fallback initial would spend more of the one-volt-per-screen budget,
          so both are overridden to the always-ink inset token. */}
      <Avatar
        src={entry.photoURL}
        name={entry.displayName}
        size="sm"
        ring="none"
        className="bg-ink-panel text-white"
      />
      {/* The whole name block is the target rather than just the text, so a
          thumb has something to hit. */}
      <Link
        href={`/u/${entry.uid}`}
        className="min-w-0 flex-1 truncate text-sm hover:underline"
      >
        <span className="font-bold text-white">
          {entry.displayName}
          {entry.isSelf ? " (you)" : ""}
        </span>
        {entry.username && (
          <span className="ml-1 text-xs text-ink-label">@{entry.username}</span>
        )}
      </Link>
      <span className="flex shrink-0 flex-col items-end leading-tight">
        <span className="text-sm">
          <span
            className={cn(
              "type-display text-lg",
              entry.isSelf ? "text-primary" : "text-white"
            )}
          >
            {value}
          </span>
          <span className="type-overline ml-1 text-[11px] text-ink-label">
            {value === 1 ? "day" : "days"}
          </span>
        </span>
        {weeks !== null && weeks > 0 && (
          <span className="type-overline text-[10px] text-ink-label">
            {weeks}w unbroken
          </span>
        )}
        {/* Spare skips earned by completing whole weeks. Shown as a count
            rather than repeated glyphs — someone forty weeks in would
            otherwise have a row of forty. */}
        {entry.badges > 0 && (
          <span
            title={`${entry.badges} spare skip${entry.badges === 1 ? "" : "s"} earned by completing whole weeks`}
            className="type-overline text-[10px] text-primary"
          >
            ◆ {entry.badges} spare
          </span>
        )}
      </span>
    </li>
  );
}
