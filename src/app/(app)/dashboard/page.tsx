import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { TodayView } from "@/components/today-view";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  return (
    <TodayView uid={user.uid} displayName={user.displayName} photoURL={user.photoURL} />
  );
}
