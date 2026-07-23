import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { GroupsView } from "@/components/groups-view";

export default async function GroupsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/groups");

  return <GroupsView uid={user.uid} />;
}
