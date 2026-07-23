import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Policy — Habitual" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <header>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Habitual
        </Link>
        <h1 className="mt-2 type-display text-3xl">Privacy Policy</h1>
      </header>

      <main className="flex flex-col gap-4 text-sm leading-relaxed [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold">
        <p className="text-muted-foreground">Last updated: July 2026</p>

        <h2>What we collect</h2>
        <p>
          When you sign in with Google we store your name, email address, and
          profile photo. If you sign up with email and password instead, we
          store your email, the name you give us, and your password only as a
          secure hash managed by Firebase Authentication — we never see or
          store it in plain text. We also store your timezone (for day
          boundaries), the challenges and check-ins you create, ledger records,
          any receipts or avatars you upload, and — if you enable notifications
          — a push token for your device.
        </p>

        <h2>What other users see</h2>
        <p>
          Members of a group challenge see your display name, avatar, progress,
          and outcome. Counterparties of a debt see the debt, its status, and
          any receipt you attach. Anyone with a join link sees the challenge
          preview, including the host&apos;s name.
        </p>

        <h2>Where it lives</h2>
        <p>
          Data is stored in Google Firebase (Firestore, Cloud Storage, Cloud
          Messaging) and served through Vercel. We don&apos;t sell your data or
          use third-party advertising.
        </p>

        <h2>Cookies</h2>
        <p>
          We use a single HTTP-only session cookie to keep you signed in. No
          tracking cookies.
        </p>

        <h2>Deletion</h2>
        <p>
          Deleting your account (Settings → Delete account) removes your
          profile, challenges, check-ins, uploads, and sign-in record. Ledger
          entries you share with other users are kept for their records with
          your name replaced by &quot;Deleted user&quot;.
        </p>

        <h2>Contact</h2>
        <p>Questions? Contact the operator of this deployment.</p>
      </main>

      <footer className="p-2 text-center text-xs text-muted-foreground">
        <Link href="/terms" className="underline">
          Terms of Service
        </Link>
      </footer>
    </div>
  );
}
