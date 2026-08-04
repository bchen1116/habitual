import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { addDaysYmd, dateToYmdUTC, daysBetweenInclusive } from "./dates";
import { sendPushToMany } from "./notifications";
import { effectiveSkipDays } from "./badges";

interface ChallengeData {
  name: string;
  frequency: { type: "daily" | "weekly_count"; target: number };
  skipDays: number;
  stakeAmount: number;
  startDate: string;
  endDate: string;
  status: string;
  forfeitType: "charity" | "pool";
  /**
   * Set when this habit's next cycle already exists — by the auto-repeat job,
   * which must build it before grading (see functions/src/auto-repeat.ts), or
   * by the Repeat button, which is normally pressed the day a habit ends,
   * long before grading. Either way this cycle's badges are settled here, so
   * they land on the successor from here.
   */
  repeatedToId?: string | null;
}

interface MemberData {
  displayName: string;
  username: string | null;
  charityName: string | null; // null in pool mode
  // yyyymmdd; absent on members created before this field existed, and for
  // the creator it's always the challenge's own startDate — see joinedDate
  // in src/lib/server/challenge-admin.ts (mirrored here since this Cloud
  // Function has no shared package with the Next app).
  joinedDate?: string;
  /**
   * Badges rolled forward from earlier cycles of this habit — see
   * repeatChallengeAdmin. Absent on members predating badges; treat as 0.
   */
  badgesCarried?: number;
}

interface MemberOutcome {
  uid: string;
  displayName: string;
  username: string | null;
  charityName: string | null;
  succeeded: boolean;
}

/**
 * A member's own starting point for "days/weeks required" — the challenge's
 * startDate, unless they joined after it started (joining mid-challenge is
 * allowed, see joinChallengeAdmin), in which case it's their own
 * joinedDate. Mirrors effectiveStart() in src/lib/progress.ts — this is the
 * money-determining half of that fairness fix, without which a late joiner
 * would be charged for every day before they were even a member.
 */
function effectiveStart(challenge: ChallengeData, memberJoinedDate?: string): string {
  return memberJoinedDate && memberJoinedDate > challenge.startDate
    ? memberJoinedDate
    : challenge.startDate;
}

/**
 * How many check-ins one 7-day window demands of one member: nothing if it
 * concluded before they joined, the full target if it began on or after they
 * joined, and otherwise prorated by the days they actually had.
 *
 * The `daysAvailable` cap is the point. Only one check-in can exist per
 * member per day (the doc id is `${localDate}_${uid}`), so without it a
 * 5×/week habit joined on a Saturday would owe 5 check-ins across 2 days —
 * a shortfall this function would charge, and one large enough to fail the
 * challenge and move real money, for something no amount of effort could
 * have prevented. `ceil` keeps the prorated figure demanding, and it never
 * reaches 0, so joining late is not a way to buy a free week either.
 *
 * Mirrors windowRequirement() in src/lib/progress.ts (this Cloud Function
 * shares no package with the Next app). The two must agree — this copy
 * decides the money, that one makes the promise the member sees.
 */
export function windowRequirement(
  target: number,
  windowStart: string,
  windowEnd: string,
  memberStart: string
): number {
  if (windowEnd < memberStart) return 0;
  if (windowStart >= memberStart) return target;
  const daysAvailable = daysBetweenInclusive(memberStart, windowEnd);
  return Math.min(daysAvailable, Math.ceil((target * daysAvailable) / 7));
}

/**
 * Missed check-ins per docs/03. Daily: required = day count from the
 * member's own effective start. weekly_count: sequential 7-day windows from
 * the challenge's startDate (whole-week durations enforced at creation) —
 * the grid itself never shifts, but each window's requirement is resolved
 * per member by windowRequirement above. Per-window shortfalls summed, so
 * front-loading week one doesn't satisfy later ones.
 */
export function computeMissed(
  challenge: ChallengeData,
  checkinYmds: readonly string[],
  memberJoinedDate?: string
): { missed: number; completed: number } {
  const start = effectiveStart(challenge, memberJoinedDate);
  const inRange = checkinYmds.filter(
    (d) => d >= challenge.startDate && d <= challenge.endDate
  );
  if (start > challenge.endDate) return { missed: 0, completed: inRange.length };

  if (challenge.frequency.type === "daily") {
    const days = daysBetweenInclusive(start, challenge.endDate);
    const completedSinceStart = inRange.filter((d) => d >= start).length;
    return { missed: days - completedSinceStart, completed: inRange.length };
  }

  const days = daysBetweenInclusive(challenge.startDate, challenge.endDate);
  const weeks = Math.floor(days / 7);
  const target = challenge.frequency.target;
  let missed = 0;
  for (let w = 0; w < weeks; w++) {
    const windowStart = addDaysYmd(challenge.startDate, w * 7);
    const windowEnd = addDaysYmd(windowStart, 6);
    if (windowEnd < start) continue;
    const required = windowRequirement(target, windowStart, windowEnd, start);
    const count = inRange.filter((d) => d >= windowStart && d <= windowEnd).length;
    missed += Math.max(0, required - count);
  }
  return { missed, completed: inRange.length };
}

/**
 * Hours to wait past an end date before grading it.
 *
 * Was 36: a challenge ending "July 22" isn't over everywhere on earth until
 * July 23 12:00 UTC, because the last timezone to finish July 22 is UTC-12,
 * where 23:59 local is 11:59 UTC the next day.
 *
 * The 3am habit-day cutoff (DAY_CUTOFF_HOUR in src/lib/dates.ts) extends that.
 * The last instant someone can still log July 22 is 02:59 on July 23 *local*,
 * which in UTC-12 is 14:59 UTC on July 23 — three hours later than the old
 * buffer allowed. At 36 the nightly run could grade a member while their day
 * was still open and their stake still winnable. 39 moves the earliest
 * possible grading to exactly that last instant.
 */
const ADJUDICATION_BUFFER_HOURS = 39;

/**
 * `endDate <= yyyymmdd(now − ADJUDICATION_BUFFER_HOURS)` first becomes true at
 * the moment the final member on earth can no longer check in.
 */
export function adjudicationCutoffYmd(now: Date): string {
  return dateToYmdUTC(
    new Date(now.getTime() - ADJUDICATION_BUFFER_HOURS * 60 * 60 * 1000)
  );
}

/** Adjudicates every ended challenge. Returns the number processed. */
export async function adjudicateEndedChallenges(now: Date): Promise<number> {
  const db = getFirestore();
  const cutoff = adjudicationCutoffYmd(now);
  // The run date, for the "a badge's week must be over" rule in badges.ts.
  // Every challenge selected below ended at least 39 hours ago, so this is
  // always past their final window and the rule withholds nothing here.
  const cutoffToday = dateToYmdUTC(now);

  const ended = await db
    .collection("challenges")
    .where("status", "==", "active")
    .where("endDate", "<=", cutoff)
    .get();

  let processed = 0;
  for (const challengeDoc of ended.docs) {
    try {
      let notifyMemberUids: string[] = [];
      let notifiedChallengeName = "";
      await db.runTransaction(async (t) => {
        // Reads first (transaction requirement), starting with the
        // idempotency guard: another run may have adjudicated it already.
        const fresh = await t.get(challengeDoc.ref);
        const challenge = fresh.data() as ChallengeData | undefined;
        if (!challenge || challenge.status !== "active") return;

        const membersSnap = await t.get(challengeDoc.ref.collection("members"));
        const checkinsSnap = await t.get(challengeDoc.ref.collection("checkins"));

        const checkinsByUid = new Map<string, string[]>();
        for (const doc of checkinsSnap.docs) {
          const { uid, localDate } = doc.data() as {
            uid: string;
            localDate: string;
          };
          const list = checkinsByUid.get(uid) ?? [];
          list.push(localDate);
          checkinsByUid.set(uid, list);
        }

        const adjudicatedAt = Timestamp.fromDate(now);
        const outcomes: MemberOutcome[] = [];
        const memberUpdates: {
          ref: FirebaseFirestore.DocumentReference;
          missed: number;
          completed: number;
          succeeded: boolean;
          allowance: { base: number; carried: number; earned: number; total: number };
        }[] = [];
        for (const memberDoc of membersSnap.docs) {
          const member = memberDoc.data() as MemberData;
          const uid = memberDoc.id;
          const ymds = checkinsByUid.get(uid) ?? [];
          const { missed, completed } = computeMissed(
            challenge,
            ymds,
            member.joinedDate
          );
          // Badges are spare skips, earned a week at a time and spent
          // automatically. Nothing to redeem: a reward you must remember to
          // claim before a nightly job you cannot see is a trap, not a reward.
          // The run date as `today`. The 39-hour buffer above guarantees it is
          // past endDate, so every window of this challenge has closed and the
          // "week must be over" rule inside can't withhold anything here — it
          // only ever suppresses a week still in progress, and by now there
          // are none.
          const allowance = effectiveSkipDays(
            challenge,
            ymds,
            cutoffToday,
            member.joinedDate,
            member.badgesCarried
          );
          const succeeded = missed <= allowance.total;
          outcomes.push({
            uid,
            displayName: member.displayName,
            username: member.username ?? null,
            charityName: member.charityName ?? null,
            succeeded,
          });
          // Deferred to after the venmo reads below — transactions require
          // every read to happen before the first write.
          memberUpdates.push({
            ref: memberDoc.ref,
            missed,
            completed,
            succeeded,
            allowance,
          });
        }

        // Pool mode: each winner's Venmo handle rides onto the loser's
        // ledger entry as toVenmoUsername, giving the debtor a prefilled
        // Pay-with-Venmo link. Read fresh from users/{uid} NOW — at the
        // moment the debt is created — rather than from a join-time member
        // snapshot: a handle added to the profile any time before results
        // (the common order of events) still gets picked up, including for
        // challenges that started long before the profile field existed.
        // The debtor couldn't read the winner's user doc themselves
        // (users/{uid} rules are owner-only); this server-side copy onto
        // the one ledger entry the debtor can read is the entire exposure.
        const venmoByUid = new Map<string, string | null>();
        if (challenge.forfeitType === "pool") {
          const winnerUids = outcomes.filter((o) => o.succeeded).map((o) => o.uid);
          if (winnerUids.length > 0) {
            const userSnaps = await t.getAll(
              ...winnerUids.map((uid) => db.collection("users").doc(uid))
            );
            for (const snap of userSnaps) {
              venmoByUid.set(
                snap.id,
                (snap.data()?.venmoUsername as string | undefined) ?? null
              );
            }
          }
        }

        // Auto-repeat builds the successor a day before this cycle ends, so
        // the badges it copied forward were the pre-grading total. Now that
        // the final weeks are graded, correct it — otherwise a habit that
        // repeats itself quietly loses every badge earned in its last cycle,
        // which is the one people are most likely to have been counting on.
        //
        // Only members the successor actually has: someone who joined this
        // cycle after the successor was built isn't in it, and writing a
        // lone badgesCarried field would conjure a member doc for a challenge
        // whose memberIds never listed them.
        const successorRef = challenge.repeatedToId
          ? db.collection("challenges").doc(challenge.repeatedToId)
          : null;
        const successorMemberIds = new Set<string>();
        if (successorRef) {
          const successorMembers = await t.get(successorRef.collection("members"));
          for (const doc of successorMembers.docs) successorMemberIds.add(doc.id);
        }

        for (const update of memberUpdates) {
          if (successorRef && successorMemberIds.has(update.ref.id)) {
            t.update(successorRef.collection("members").doc(update.ref.id), {
              badgesCarried: update.allowance.carried + update.allowance.earned,
            });
          }
          t.update(update.ref, {
            outcome: update.succeeded ? "succeeded" : "failed",
            completedCount: update.completed,
            skipsUsed: Math.min(update.missed, update.allowance.total),
            // Frozen alongside the outcome so a result can always be explained
            // later, even if the badge rules change underneath it.
            badgesEarned: update.allowance.earned,
            skipsAllowed: update.allowance.total,
            // What a repeat of this habit starts with (repeatChallengeAdmin).
            badgesCarried: update.allowance.carried + update.allowance.earned,
            adjudicatedAt,
          });
        }

        const baseEntry = {
          challengeId: challengeDoc.id,
          challengeName: challenge.name,
          amount: challenge.stakeAmount,
          status: "unsettled",
          settledAt: null,
          receiptURL: null,
          note: null,
          createdAt: FieldValue.serverTimestamp(),
        };

        if (challenge.forfeitType === "pool") {
          // Winner pool (docs/05): each loser's stake splits evenly among
          // the winners. No winners -> wash: no entries, but execution
          // still falls through so the challenge is marked adjudicated.
          const winners = outcomes.filter((o) => o.succeeded);
          const losers = outcomes.filter((o) => !o.succeeded);
          if (winners.length > 0) {
            const perWinnerShare = challenge.stakeAmount / winners.length;
            for (const loser of losers) {
              for (const winner of winners) {
                t.set(db.collection("ledgerEntries").doc(), {
                  ...baseEntry,
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
          }
        } else {
          // Charity forfeit: each failed member owes their own charity.
          for (const loser of outcomes.filter((o) => !o.succeeded)) {
            t.set(db.collection("ledgerEntries").doc(), {
              ...baseEntry,
              fromUid: loser.uid,
              fromName: loser.displayName,
              fromUsername: loser.username,
              toType: "charity",
              toUid: null,
              toName: null,
              toUsername: null,
              toCharityName: loser.charityName ?? "Charity",
            });
          }
        }

        // Runs for every processed challenge, including zero-ledger ones —
        // an early return above this point would re-process forever.
        t.update(challengeDoc.ref, { status: "adjudicated", adjudicatedAt });

        notifyMemberUids = outcomes.map((o) => o.uid);
        notifiedChallengeName = challenge.name;
      });
      processed++;

      // After the commit — a notification failure must not roll back or
      // re-run adjudication.
      if (notifyMemberUids.length > 0) {
        await sendPushToMany(notifyMemberUids, {
          title: "Results are in",
          body: `"${notifiedChallengeName}" has been graded — see how everyone did.`,
          targetUrl: `/challenges/${challengeDoc.id}`,
          category: "challengeLifecycle",
        }).catch((err) => logger.warn("results push failed", err));
      }
    } catch (err) {
      // One bad challenge must not block the rest; it retries next run.
      logger.error(`Adjudication failed for challenge ${challengeDoc.id}`, err);
    }
  }
  return processed;
}
