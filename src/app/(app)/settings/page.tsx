import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { DeleteAccount } from "@/components/delete-account";
import { ProfileEditor } from "@/components/profile-editor";
import { SignOutButton } from "@/components/sign-out-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="type-display text-3xl">Settings</h1>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Back to dashboard
        </Link>
      </header>

      <main className="flex flex-1 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileEditor uid={user.uid} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>
              Push reminders, results, and ledger updates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/settings/notifications"
              className="text-sm underline hover:text-foreground"
            >
              Notification settings
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-4 text-sm">
            <Link href="/terms" className="underline hover:text-foreground">
              Terms of Service
            </Link>
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <SignOutButton />
            <DeleteAccount />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
