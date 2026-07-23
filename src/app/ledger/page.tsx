import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LedgerList } from "@/components/ledger-list";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/ledger");

  const { tab } = await searchParams;
  const initialTab = tab === "owed" ? "owed" : "owe";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Ledger</h1>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Back to dashboard
        </Link>
      </header>
      <main className="flex-1">
        <LedgerList uid={user.uid} initialTab={initialTab} />
      </main>
    </div>
  );
}
