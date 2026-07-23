import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { addDaysYmd, dateToYmdUTC, daysBetweenInclusive } from "./dates";

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
  charityName: string | null; // null in pool mode
}

interface MemberOutcome {
  uid: string;
  displayName: string;
  charityName: string | null;
  succeeded: boolean;
}

/**
 * Missed check-ins per docs/03. Daily: required = day count. weekly_count:
 * sequential 7-day windows from startDate (whole-week durations enforced at
 * creation); per-window shortfalls summed, so front-loading week one doesn't
 * satisfy later windows.
 */
export function computeMissed(
  challenge: ChallengeData,
  checkinYmds: readonly string[]
): { missed: number; completed: number } {
  const inRange = checkinYmds.filter(
    (d) => d >= challenge.startDate && d <= challenge.endDate
  );
  const days = daysBetweenInclusive(challenge.startDate, challenge.endDate);

  if (challenge.frequency.type === "daily") {
    return { missed: days - inRange.length, completed: inRange.length };
  }

  const weeks = Math.floor(days / 7);
  const target = challenge.frequency.target;
  let missed = 0;
  for (let w = 0; w < weeks; w++) {
    const start = addDaysYmd(challenge.startDate, w * 7);
    const end = addDaysYmd(start, 6);
    const count = inRange.filter((d) => d >= start && d <= end).length;
    missed += Math.max(0, target - count);
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
        for (const memberDoc of membersSnap.docs) {
          const member = memberDoc.data() as MemberData;
          const uid = memberDoc.id;
          const { missed, completed } = computeMissed(
            challenge,
            checkinsByUid.get(uid) ?? []
          );
          const succeeded = missed <= challenge.skipDays;
          outcomes.push({
            uid,
            displayName: member.displayName,
            charityName: member.charityName ?? null,
            succeeded,
          });

          t.update(memberDoc.ref, {
            outcome: succeeded ? "succeeded" : "failed",
            completedCount: completed,
            skipsUsed: Math.min(missed, challenge.skipDays),
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
                  toType: "user",
                  toUid: winner.uid,
                  toName: winner.displayName,
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
              toType: "charity",
              toUid: null,
              toName: null,
              toCharityName: loser.charityName ?? "Charity",
            });
          }
        }

        // Runs for every processed challenge, including zero-ledger ones —
        // an early return above this point would re-process forever.
        t.update(challengeDoc.ref, { status: "adjudicated", adjudicatedAt });
      });
      processed++;
    } catch (err) {
      // One bad challenge must not block the rest; it retries next run.
      logger.error(`Adjudication failed for challenge ${challengeDoc.id}`, err);
    }
  }
  return processed;
}
