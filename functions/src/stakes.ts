/**
 * Who a finished cycle moves money between.
 *
 * Split out of adjudicate.ts and made pure so it can be driven over fixtures
 * directly. Everything else in that file needs a Firestore transaction to
 * exercise, which meant the one decision in it that moves real money was the
 * one decision nothing could test. The rules here are short enough to read
 * and easy enough to get subtly wrong — an excused member counted as a winner
 * takes a share of other people's stakes; counted as a loser, they pay one.
 */

/** One member's graded standing, before anyone is excused from the stake. */
export interface GradedMember {
  uid: string;
  displayName: string;
  username: string | null;
  charityName: string | null;
  succeeded: boolean;
  /**
   * Out of this cycle entirely: booked past the time-off budget, or excused by
   * the creator (which resolves to the same cycle-wide step-out — see
   * excludedFromCycle in away.ts). Both mean the same thing to money.
   */
  steppedOut: boolean;
  /**
   * The cycle required nothing of them — they joined after its last day, or
   * every day they were a member was excused.
   *
   * Kept separate from `steppedOut` because the causes are unrelated and the
   * recorded outcome should be able to say which happened. What they share is
   * the only thing that matters here: neither is a person the stake applies
   * to. Without this the two produce the same `missed` of 0 and therefore the
   * same `succeeded` of true, and a member who joined the day a four-week
   * cycle ended would be paid a full share of everyone else's forfeits for
   * having been asked for nothing.
   */
  askedNothing: boolean;
}

export type StakedMember = Omit<GradedMember, "steppedOut" | "askedNothing">;

/**
 * The members this cycle's stake actually applies to.
 *
 * Anyone the cycle did not put at stake is dropped here, once, and everything
 * downstream is built from the result — so there is exactly one place that can
 * include or exclude someone from the money, rather than a rule repeated at
 * each of the ledger's two branches. Two unrelated reasons land here: out of
 * the cycle (`steppedOut`), and never asked anything by it (`askedNothing`).
 *
 * Dropping them has to be an omission rather than `succeeded: true`. In pool
 * mode the winners divide the losers' stakes, so marking an absent member as
 * a winner would pay them out of other people's money for a cycle they took
 * no part in — the precise unfairness that stepping out exists to avoid. And
 * it can't be `succeeded: false` either: that bills them for a cycle nobody
 * asked them to complete.
 */
export function stakedMembers(all: readonly GradedMember[]): StakedMember[] {
  return all
    .filter((m) => !m.steppedOut && !m.askedNothing)
    .map(({ steppedOut: _steppedOut, askedNothing: _askedNothing, ...rest }) => rest);
}

/** A ledger entry's participants and amount; the rest is filled in by the caller. */
export interface LedgerDraft {
  fromUid: string;
  fromName: string;
  fromUsername: string | null;
  toType: "user" | "charity";
  toUid: string | null;
  toName: string | null;
  toUsername: string | null;
  toVenmoUsername: string | null;
  toCharityName: string | null;
  amount: number;
}

/**
 * Every debt this cycle creates.
 *
 * Pool: each loser's stake splits evenly among the winners, one entry per
 * loser-winner pair. With no winners it's a wash and nobody owes anything —
 * the stake is only ever redistributed, never collected by the app.
 *
 * Charity: each loser owes their own chosen charity their own stake. Winners
 * are irrelevant to it, which is why a charity habit still works with one
 * member.
 *
 * In both modes the total leaving the losers is exactly `stakeAmount` each,
 * and nothing is owed by or to anyone `stakedMembers` left out.
 */
export function ledgerDrafts(
  staked: readonly StakedMember[],
  challenge: { forfeitType: "charity" | "pool"; stakeAmount: number },
  /** Winner handles, for the debtor's prefilled Venmo link. Pool mode only. */
  venmoByUid: ReadonlyMap<string, string | null> = new Map()
): LedgerDraft[] {
  const losers = staked.filter((m) => !m.succeeded);

  if (challenge.forfeitType === "charity") {
    return losers.map((loser) => ({
      fromUid: loser.uid,
      fromName: loser.displayName,
      fromUsername: loser.username,
      toType: "charity" as const,
      toUid: null,
      toName: null,
      toUsername: null,
      toVenmoUsername: null,
      toCharityName: loser.charityName ?? "Charity",
      amount: challenge.stakeAmount,
    }));
  }

  const winners = staked.filter((m) => m.succeeded);
  if (winners.length === 0) return [];

  const perWinnerShare = challenge.stakeAmount / winners.length;
  const drafts: LedgerDraft[] = [];
  for (const loser of losers) {
    for (const winner of winners) {
      drafts.push({
        fromUid: loser.uid,
        fromName: loser.displayName,
        fromUsername: loser.username,
        toType: "user",
        toUid: winner.uid,
        toName: winner.displayName,
        toUsername: winner.username,
        toVenmoUsername: venmoByUid.get(winner.uid) ?? null,
        toCharityName: null,
        amount: perWinnerShare,
      });
    }
  }
  return drafts;
}
