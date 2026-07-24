"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActiveChallengeCheckins } from "@/hooks/use-active-challenge-checkins";
import { useMaxChainStreak } from "@/hooks/use-chain-streak";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import { todayYmd } from "@/lib/dates";
import { maxLongestStreak } from "@/lib/streak";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Today" },
  { href: "/challenges", label: "Habits" },
  { href: "/stats", label: "Progress" },
  { href: "/groups", label: "Groups" },
  { href: "/ledger", label: "Ledger" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar({ uid }: { uid: string }) {
  const pathname = usePathname();
  const timezone = useUserTimezone(uid);
  const { challenges, checkinsByChallenge } = useActiveChallengeCheckins(uid);

  const today = todayYmd(timezone);
  const activeChallenges = challenges ?? [];
  const checkinYmdsByChallenge = Object.fromEntries(
    Object.entries(checkinsByChallenge).map(([id, records]) => [
      id,
      records.map((r) => r.localDate),
    ])
  );
  const streak = useMaxChainStreak(activeChallenges, uid, checkinYmdsByChallenge, today);
  const best = maxLongestStreak(activeChallenges, checkinYmdsByChallenge, today);

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
        <span className="type-display text-4xl text-white">{streak}</span>
        <span className="type-overline text-ink-label">Days · Best {best}</span>
      </div>
    </aside>
  );
}
