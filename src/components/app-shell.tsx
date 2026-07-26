"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AppOverviewDialog } from "@/components/app-overview-dialog";
import { BottomNav } from "@/components/bottom-nav";
import { Sidebar } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { useClientAuthUser } from "@/hooks/use-client-auth-user";

export function AppShell({ uid, children }: { uid: string; children: ReactNode }) {
  const { user, ready } = useClientAuthUser();

  // The server-side session cookie (checked by (app)/layout.tsx before this
  // even renders) and the client Firebase Auth SDK's own session are two
  // independent things — every direct Firestore read from the browser is
  // authorized against the latter, not the cookie. If they've drifted apart
  // (cleared storage, a cookie copied across devices/browsers, etc.), the
  // page renders as "signed in" while every single Firestore query fails
  // permission-denied — which previously showed as an unhelpful, misleading
  // "Couldn't load, check your connection" on every list in the app. This
  // catches that specific case and says what's actually wrong instead.
  if (ready && (!user || user.uid !== uid)) {
    return (
      <div className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="font-bold">Your session needs to be refreshed</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          You&apos;ll need to sign in again to keep using Habitual on this
          device.
        </p>
        <Button asChild>
          <Link href="/login">Sign in again</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar uid={uid} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <main className="flex-1 pb-24 md:pb-0">{children}</main>
      </div>
      <BottomNav />
      <AppOverviewDialog uid={uid} />
    </div>
  );
}
