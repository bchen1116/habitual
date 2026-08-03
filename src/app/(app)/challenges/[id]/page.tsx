import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { BackButton } from "@/components/back-button";
import { ChallengeDetail } from "@/components/challenge-detail";

export default async function ChallengePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/challenges/${id}`);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      {/* No page title beside it: the habit's own name is the first thing
          ChallengeDetail renders, and a generic "Challenge" above it was one
          heading saying nothing over another saying the useful thing. */}
      <header className="flex items-center">
        <BackButton fallbackHref="/challenges" />
      </header>
      <main className="flex-1">
        <ChallengeDetail id={id} uid={user.uid} />
      </main>
    </div>
  );
}
