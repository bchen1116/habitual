import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { addDaysYmd, dateToYmdUTC, daysBetweenInclusive } from "./dates";
import { sendPushToMany } from "./notifications";

interface ChallengeData {
  name: string;
  frequency: { type: "daily" | "weekly_count"; target: number };
  skipDays: number;
  stakeAmount: number;
  startDate: string;
  endDate: string;
  status: string;
  forfeitType: "charity" | "pool";
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
 * The 36-hour buffer (docs/03): a challenge ending "July 22" isn't over
 * everywhere on earth until July 23 12:00 UTC. `endDate <= yyyymmdd(now − 36h)`
 * first becomes true exactly then.
 */
export function adjudicationCutoffYmd(now: Date): string {
  return dateToYmdUTC(new Date(now.getTime() - 36 * 60 * 60 * 1000));
}

/** Adjudicates every ended challenge. Returns the number processed. */
export async function adjudicateEndedChallenges(now: Date): Promise<number> {
  const db = getFirestore();
  const cutoff = adjudicationCutoffYmd(now);

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
        }[] = [];
        for (const memberDoc of membersSnap.docs) {
          const member = memberDoc.data() as MemberData;
          const uid = memberDoc.id;
          const { missed, completed } = computeMissed(
            challenge,
            checkinsByUid.get(uid) ?? [],
            member.joinedDate
          );
          const succeeded = missed <= challenge.skipDays;
          outcomes.push({
            uid,
            displayName: member.displayName,
            username: member.username ?? null,
            charityName: member.charityName ?? null,
            succeeded,
          });
          // Deferred to after the venmo reads below — transactions require
          // every read to happen before the first write.
          memberUpdates.push({ ref: memberDoc.ref, missed, completed, succeeded });
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

        for (const update of memberUpdates) {
          t.update(update.ref, {
            outcome: update.succeeded ? "succeeded" : "failed",
            completedCount: update.completed,
            skipsUsed: Math.min(update.missed, challenge.skipDays),
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
