import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { BackButton } from "@/components/back-button";
import { NotificationSettings } from "@/components/notification-settings";

export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings/notifications");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center gap-2">
        <BackButton fallbackHref="/settings" />
        <h1 className="type-display text-3xl">Notifications</h1>
      </header>
      <main className="flex-1">
        <NotificationSettings uid={user.uid} />
      </main>
    </div>
  );
}
