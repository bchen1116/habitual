import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { ChallengeList } from "@/components/challenge-list";
import { InstallBanner } from "@/components/install-banner";
import { LedgerSummary } from "@/components/ledger-summary";
import { PushProvider } from "@/components/push-provider";
import { Button } from "@/components/ui/button";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="type-display text-3xl">Habitual</h1>
        <Link
          href="/settings"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Settings
        </Link>
      </header>

      <main className="flex flex-1 flex-col gap-4">
        <PushProvider uid={user.uid} />
        <InstallBanner />
        <LedgerSummary uid={user.uid} />
        <div className="flex items-center justify-between">
          <h2 className="type-display text-xl">Your challenges</h2>
          <Button asChild size="sm" variant="secondary">
            <Link href="/challenges/new">+ New challenge</Link>
          </Button>
        </div>
        <ChallengeList uid={user.uid} />
      </main>
    </div>
  );
}
