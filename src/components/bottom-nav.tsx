"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ListChecks, Plus, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const LEFT_ITEMS = [
  { href: "/dashboard", label: "Today", Icon: Zap },
  { href: "/challenges", label: "Habits", Icon: ListChecks },
];
const RIGHT_ITEMS = [
  { href: "/stats", label: "Stats", Icon: BarChart3 },
  { href: "/groups", label: "Groups", Icon: Users },
];

export function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-end justify-between bg-ink px-[30px] pb-[26px] pt-3.5 md:hidden">
      {LEFT_ITEMS.map((item) => (
        <NavSlot key={item.href} {...item} active={isActive(item.href)} />
      ))}
      <Link
        href="/challenges/new"
        aria-label="New habit"
        className="-mt-6 flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
      >
        <Plus className="h-7 w-7" strokeWidth={2.5} />
      </Link>
      {RIGHT_ITEMS.map((item) => (
        <NavSlot key={item.href} {...item} active={isActive(item.href)} />
      ))}
    </nav>
  );
}

function NavSlot({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: typeof Zap;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "type-overline flex flex-col items-center gap-1 text-[11px]",
        active ? "text-primary" : "text-ink-nav-inactive"
      )}
    >
      <Icon
        className={cn("h-5 w-5", active ? "text-primary" : "text-ink-icon-inactive")}
      />
      {label}
    </Link>
  );
}
