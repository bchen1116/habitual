import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { Sidebar } from "@/components/sidebar";

export function AppShell({ uid, children }: { uid: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar uid={uid} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <main className="flex-1 pb-24 md:pb-0">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
