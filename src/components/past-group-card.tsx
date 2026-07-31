import Link from "next/link";
import { totalRequired } from "@/lib/progress";
import { Badge } from "@/components/ui/badge";
import type { CompletedChallengeEntry } from "@/lib/challenge-stats";

/**
 * A finished group challenge — unlike GroupCard (live avatar stack, "X of Y
 * checked in today"), a completed challenge has no "today" to check into, so
 * this shows the decided outcome and final completion instead.
 */
export function PastGroupCard({ entry }: { entry: CompletedChallengeEntry }) {
  const { challenge, outcome, completedCount, joinedDate } = entry;
  // Their own requirement, not the creator's — see joinedDate on
  // CompletedChallengeEntry.
  const total = totalRequired(challenge, joinedDate);
  const percent = total > 0 ? Math.round(Math.min(100, (completedCount / total) * 100)) : 0;

  return (
    <Link
      href={`/challenges/${challenge.id}`}
      className="flex items-center justify-between gap-3 rounded-[20px] bg-card p-5 transition-opacity hover:opacity-90"
    >
      <div className="min-w-0">
        <h3 className="type-display truncate text-xl">{challenge.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{percent}% completed</p>
      </div>
      <div className="shrink-0">
        {outcome === "succeeded" && <Badge variant="volt">Won</Badge>}
        {outcome === "failed" && <Badge variant="secondary">Lost</Badge>}
        {outcome === null && <Badge variant="outline">Group</Badge>}
      </div>
    </Link>
  );
}
