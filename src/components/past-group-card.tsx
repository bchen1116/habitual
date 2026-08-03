import Link from "next/link";
import { totalRequired } from "@/lib/progress";
import { Badge } from "@/components/ui/badge";
import type { CompletedChallengeEntry } from "@/lib/challenge-stats";

/**
 * A finished group challenge — unlike GroupCard (live avatar stack, "X of Y
 * checked in today"), a completed challenge has no "today" to check into, so
 * this shows the decided outcome and final completion instead.
 *
 * `pending` covers the gap between a group ending and the nightly job grading
 * it: the outcome genuinely isn't known yet, so claiming one either way would
 * be a lie about money.
 */
export function PastGroupCard({
  entry,
  pending,
}: {
  entry: CompletedChallengeEntry;
  /** Past its end date but not yet graded — a real outcome is still coming. */
  pending?: boolean;
}) {
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
        <p className="mt-1 text-sm text-muted-foreground">
          {percent}% completed{pending && " · results coming"}
        </p>
      </div>
      <div className="shrink-0">
        {outcome === "succeeded" && <Badge variant="volt">Won</Badge>}
        {outcome === "failed" && <Badge variant="secondary">Lost</Badge>}
        {outcome === null && (
          <Badge variant="outline">{pending ? "Pending" : "Group"}</Badge>
        )}
      </div>
    </Link>
  );
}
