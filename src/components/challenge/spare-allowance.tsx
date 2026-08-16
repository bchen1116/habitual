import type { SkipAllowance } from "@/lib/badges";

/**
 * The spare-skip line under a habit's progress bar.
 *
 * Two sentences at most, and the second only when it's needed. The first
 * states the balance, because that is now a thing you hold rather than a
 * discount applied behind your back. The second fires only when misses have
 * gone past what's covering them and there are spares sitting unused — which
 * is the exact failure mode of making spares manual, so the interface has to
 * be the thing that catches it.
 *
 * Nothing here says "used automatically" any more, because nothing is. The
 * line it replaced spelled out the arithmetic of a number the reader had no
 * say in; this one describes a decision they still have to make.
 */
export function SpareAllowance({
  allowance,
  atRisk,
  canSpend,
}: {
  allowance: SkipAllowance;
  /** Misses beyond base skips + applied spares — see unprotectedMisses. */
  atRisk: number;
  /**
   * Whether a spare can still be spent here. False once the cycle is graded,
   * where the balance is worth stating — it carries to the next cycle — but
   * telling someone to go and cover a week whose result is settled would be
   * inviting them to do something the server would refuse.
   */
  canSpend: boolean;
}) {
  const { base, applied, available } = allowance;
  const plural = (n: number) => (n === 1 ? "" : "s");

  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className="text-muted-foreground">
        {available > 0 || applied > 0 ? (
          <>
            <span className="font-medium text-foreground">
              ◆ {available} spare{plural(available)} banked
            </span>
            {applied > 0 && `, ${applied} applied to this cycle`}.{" "}
            {available > 0 &&
              "They keep until you use one, including into the next cycle."}
          </>
        ) : (
          <>Check in all 7 days of a week to earn a spare skip.</>
        )}
      </p>
      {canSpend && atRisk > 0 && available > 0 && (
        <p className="font-medium text-destructive">
          You&apos;re {atRisk} past your {base} skip{plural(base)} — tap a missed
          week below to spend a spare on it.
        </p>
      )}
    </div>
  );
}
