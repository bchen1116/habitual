import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <AppShell uid={user.uid}>{children}</AppShell>;
}
