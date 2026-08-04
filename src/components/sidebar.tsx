"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActivity } from "@/components/activity-provider";
import {
  useMaxChainLongestStreak,
  useMaxChainStreak,
} from "@/hooks/use-chain-streak";
import { liveChallenges } from "@/lib/cycles";
import { todayYmd } from "@/lib/dates";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Today" },
  { href: "/challenges", label: "Habits" },
  { href: "/stats", label: "Progress" },
  { href: "/groups", label: "Groups" },
  { href: "/ledger", label: "Ledger" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { challenges, checkinsByChallenge, joinedDateByChallenge, timezone, uid } =
    useActivity();

  const today = todayYmd(timezone);
  // The same collapsed, still-running set the Today hero uses, so the two
  // streak figures can't disagree (lib/cycles.ts).
  const activeChallenges = liveChallenges(challenges ?? [], today);
  const checkinYmdsByChallenge = Object.fromEntries(
    Object.entries(checkinsByChallenge).map(([id, records]) => [
      id,
      records.map((r) => r.localDate),
    ])
  );
  const { streak, pending: streakPending } = useMaxChainStreak(
    activeChallenges,
    uid,
    checkinYmdsByChallenge,
    today,
    joinedDateByChallenge
  );
  // Chain-aware, like the Progress page's tile: a repeated habit's best-ever
  // run spans its earlier cycles rather than restarting with each one.
  const { best, pending: bestPending } = useMaxChainLongestStreak(
    activeChallenges,
    uid,
    checkinYmdsByChallenge,
    today,
    joinedDateByChallenge
  );

  return (
    <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col bg-ink px-5 py-6 md:flex">
      <Link href="/dashboard" className="flex items-center gap-2 px-1">
        <span className="h-[30px] w-[30px] shrink-0 rounded-full bg-primary" />
        <span className="type-overline text-base tracking-[0.16em] text-white">
          Habitual
        </span>
      </Link>

      <nav className="mt-8 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "type-overline flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-base",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-ink-label hover:text-white"
              )}
            >
              {!active && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-sm bg-ink-icon-inactive" />
              )}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 rounded-[14px] bg-ink-panel px-4 py-4">
        <span className="type-overline text-primary">Streak</span>
        {/* Same rule as the hero: a placeholder until the chain walk lands,
            because this panel is on every screen and a number that revises
            itself mid-navigation is the most visible way to look broken. */}
        {streakPending ? (
          <span
            role="status"
            aria-label="Loading your current streak"
            className="my-1.5 h-7 w-14 animate-pulse rounded-lg bg-white/15"
          />
        ) : (
          <span className="type-display text-4xl text-white">{streak}</span>
        )}
        <span className="type-overline text-ink-label">
          Days · Best {bestPending ? "—" : best}
        </span>
      </div>
    </aside>
  );
}
