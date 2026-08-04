import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getActiveChallengeActivity } from "@/lib/server/activity";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Prefetched here rather than per page: the shell holds the one subscription
  // (see ActivityProvider), and a layout is not re-rendered when you navigate
  // between sibling routes, so this runs once per session rather than once per
  // page view. Null on failure, which the provider treats as "load it on the
  // client" — the behaviour before any of this existed.
  const activity = await getActiveChallengeActivity(user.uid);

  return (
    <AppShell uid={user.uid} initialActivity={activity}>
      {children}
    </AppShell>
  );
}
