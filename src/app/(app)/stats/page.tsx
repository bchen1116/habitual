import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { StatsView } from "@/components/stats-view";

export default async function StatsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/stats");

  return <StatsView uid={user.uid} />;
}
