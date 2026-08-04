import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getActiveChallengeActivity } from "@/lib/server/activity";
import { TodayView } from "@/components/today-view";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  // Read here rather than letting the client do it after hydration. Null if
  // it fails, which TodayView treats as "no prefetch" and loads the old way.
  const activity = await getActiveChallengeActivity(user.uid);

  return (
    <TodayView
      uid={user.uid}
      displayName={user.displayName}
      photoURL={user.photoURL}
      initialActivity={activity}
    />
  );
}
