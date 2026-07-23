import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LedgerEntryDetail } from "@/components/ledger-entry-detail";

export default async function LedgerEntryPage({
  params,
}: {
  params: Promise<{ entryId: string }>;
}) {
  const { entryId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/ledger/${entryId}`);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Debt</h1>
        <Link
          href="/ledger"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Back to ledger
        </Link>
      </header>
      <main className="flex-1">
        <LedgerEntryDetail id={entryId} uid={user.uid} />
      </main>
    </div>
  );
}
