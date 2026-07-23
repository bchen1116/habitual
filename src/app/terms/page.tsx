import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service — Habitual" };

export default function TermsPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <header>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Habitual
        </Link>
        <h1 className="mt-2 type-display text-3xl">
          Terms of Service
        </h1>
      </header>

      <main className="flex flex-col gap-4 text-sm leading-relaxed [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold">
        <p className="text-muted-foreground">Last updated: July 2026</p>

        <h2>What Habitual is</h2>
        <p>
          Habitual is a habit-tracking scoreboard. You commit to habits with
          stakes attached; Habitual records check-ins, computes outcomes, and
          keeps a ledger of who owes what.
        </p>

        <h2>Habitual never touches money</h2>
        <p>
          Habitual does not process, hold, transfer, or facilitate payment of
          any kind. Stakes, debts, and settlements shown in the app are records
          you and other users maintain voluntarily. Settling a debt happens
          entirely outside Habitual, by whatever means you choose. Marking a
          debt &quot;settled&quot; is a record-keeping action, not a
          transaction.
        </p>

        <h2>You are responsible for your commitments</h2>
        <p>
          Debts recorded in Habitual are informal social commitments between
          you, other users, and charities you name. They are not enforceable
          obligations created by Habitual, and Habitual has no role in
          collecting, verifying, or arbitrating them. Charity donations are
          your responsibility; Habitual does not verify that any donation was
          made.
        </p>

        <h2>Disputes</h2>
        <p>
          Habitual is not liable for disputes between users about check-ins,
          outcomes, settlements, or anything else. The adjudication shown in
          the app is a computation over recorded check-ins, provided as-is.
        </p>

        <h2>Your account</h2>
        <p>
          You can delete your account at any time from Settings. Debts you owe
          or are owed remain visible to their counterparties in anonymized
          form, because their records depend on them.
        </p>

        <h2>No warranty</h2>
        <p>
          The service is provided as-is, without warranties of any kind. We may
          change or discontinue the service at any time.
        </p>
      </main>

      <footer className="p-2 text-center text-xs text-muted-foreground">
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
      </footer>
    </div>
  );
}
