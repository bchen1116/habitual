import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { NewChallengeForm } from "@/components/new-challenge-form";

export default async function NewChallengePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/challenges/new");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="type-display text-3xl">New challenge</h1>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Link>
      </header>
      <main className="flex-1">
        <NewChallengeForm />
      </main>
    </div>
  );
}
