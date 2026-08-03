import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { BackButton } from "@/components/back-button";
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
      <header className="flex items-center gap-2">
        <BackButton fallbackHref="/ledger" />
        <h1 className="type-display text-3xl">Debt</h1>
      </header>
      <main className="flex-1">
        <LedgerEntryDetail id={entryId} uid={user.uid} />
      </main>
    </div>
  );
}
