import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { ChallengeList } from "@/components/challenge-list";
import { LeaderboardCard } from "@/components/leaderboard-card";
import { Button } from "@/components/ui/button";

export default async function ChallengesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/challenges");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-5 lg:p-9">
      <div className="flex items-center justify-between">
        <h1 className="type-display text-3xl">Habits</h1>
        <Button asChild size="sm" variant="secondary">
          <Link href="/challenges/new">+ New habit</Link>
        </Button>
      </div>
      <LeaderboardCard />
      <ChallengeList uid={user.uid} />
    </div>
  );
}
