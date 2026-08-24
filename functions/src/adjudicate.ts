import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { addDaysYmd, dateToYmdUTC, daysBetweenInclusive } from "./dates";
import {
  countAwayBetween,
  memberTimeOff,
  type AwayRange,
  type CycleTimeOff,
} from "./away";
import { sendPushToMany } from "./notifications";
import { effectiveSkipDays, sparesConsumed } from "./badges";
import { ledgerDrafts, stakedMembers, type GradedMember } from "./stakes";

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
   * The unspent spare balance rolled forward from earlier cycles of this
   * habit — see repeatChallengeAdmin. Absent on members predating badges;
   * treat as 0.
   */
  badgesCarried?: number;
  /**
   * Set by the creator to excuse this member from this cycle entirely — see
   * ChallengeMember.excluded. Same money consequence as stepping out.
   */
  excluded?: boolean;
}

/** challenges/{cid}/spares/{windowStart}_{uid} — see src/lib/spares.ts. */
interface SpareData {
  uid: string;
  windowStart: string;
  count: number;
}

/** @see GradedMember in ./stakes — the shape the money decision consumes. */
type MemberOutcome = GradedMember;

/**
 * A member's own starting point for "days/weeks required" — the challenge's
 * startDate, unless they joined after it started (joining mid-challenge is
 * allowed, see joinChallengeAdmin), in which case it's their own
 * joinedDate. Mirrors effectiveStart() in src/lib/progress.ts — this is the
 * money-determining half of that fairness fix, without which a late joiner
 * would be charged for every day before they were even a member.
 */
function effectiveStart(
  challenge: Pick<ChallengeData, "startDate">,
  memberJoinedDate?: string
): string {
  return memberJoinedDate && memberJoinedDate > challenge.startDate
    ? memberJoinedDate
    : challenge.startDate;
}

/**
 * Days of one 7-day window a member was actually available for: on or after
 * their own start, and not declared away. The two exclusions are one idea —
 * days that were never theirs to use — and collapsing them is what let time
 * off be added without a second proration rule to disagree with this one.
 */
export function windowDaysAvailable(
  windowStart: string,
  windowEnd: string,
  memberStart: string,
  away?: ReadonlySet<string>
): number {
  if (windowEnd < memberStart) return 0;
  const from = windowStart >= memberStart ? windowStart : memberStart;
  const days =
    daysBetweenInclusive(from, windowEnd) - countAwayBetween(from, windowEnd, away);
  return Math.max(0, days);
}

/**
 * How many check-ins one 7-day window demands of one member: the full target
 * if they had all seven days of it, nothing if they had none (it closed before
 * they joined, or they were away for all of it), and otherwise prorated by the
 * days they actually had.
 *
 * The `daysAvailable` cap is the point. Only one check-in can exist per
 * member per day (the doc id is `${localDate}_${uid}`), so without it a
 * 5×/week habit joined on a Saturday would owe 5 check-ins across 2 days —
 * a shortfall this function would charge, and one large enough to fail the
 * challenge and move real money, for something no amount of effort could
 * have prevented. `ceil` keeps the prorated figure demanding, and it only
 * reaches 0 when there was genuinely no day to use, so joining late is not a
 * way to buy a free week either.
 *
 * Mirrors windowRequirement() in src/lib/progress.ts (this Cloud Function
 * shares no package with the Next app). The two must agree — this copy
 * decides the money, that one makes the promise the member sees.
 */
export function windowRequirement(
  target: number,
  windowStart: string,
  windowEnd: string,
  memberStart: string,
  away?: ReadonlySet<string>
): number {
  const daysAvailable = windowDaysAvailable(
    windowStart,
    windowEnd,
    memberStart,
    away
  );
  if (daysAvailable <= 0) return 0;
  if (daysAvailable >= 7) return target;
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
  // Structural rather than the whole ChallengeData: this reads three fields,
  // and narrowing it lets spare-nudge.ts call it with the same shape the
  // badge functions take instead of inventing a stake amount to satisfy a
  // type.
  challenge: Pick<ChallengeData, "frequency" | "startDate" | "endDate">,
  checkinYmds: readonly string[],
  memberJoinedDate?: string,
  away?: ReadonlySet<string>
): { missed: number; completed: number; required: number } {
  const start = effectiveStart(challenge, memberJoinedDate);
  // Away days leave the accounting on both sides — see src/lib/progress.ts.
  // A check-in banked on a declared day off is welcome and keeps the streak
  // alive, but it can't offset a miss on a day that was actually asked for.
  const inRange = checkinYmds.filter(
    (d) => d >= challenge.startDate && d <= challenge.endDate && !away?.has(d)
  );
  // Joined after the last day, so the cycle never asked them for anything.
  // `required: 0` is what the caller needs to tell that apart from a member
  // who was asked and delivered — the two produce the same `missed` and
  // absolutely must not produce the same result. See the staked/askedNothing
  // split at the call site.
  if (start > challenge.endDate) {
    return { missed: 0, completed: inRange.length, required: 0 };
  }

  if (challenge.frequency.type === "daily") {
    const days =
      daysBetweenInclusive(start, challenge.endDate) -
      countAwayBetween(start, challenge.endDate, away);
    const completedSinceStart = inRange.filter((d) => d >= start).length;
    return {
      missed: Math.max(0, days - completedSinceStart),
      completed: inRange.length,
      required: Math.max(0, days),
    };
  }

  const days = daysBetweenInclusive(challenge.startDate, challenge.endDate);
  const weeks = Math.floor(days / 7);
  const target = challenge.frequency.target;
  let missed = 0;
  let totalRequired = 0;
  for (let w = 0; w < weeks; w++) {
    const windowStart = addDaysYmd(challenge.startDate, w * 7);
    const windowEnd = addDaysYmd(windowStart, 6);
    if (windowEnd < start) continue;
    const required = windowRequirement(
      target,
      windowStart,
      windowEnd,
      start,
      away
    );
    const count = inRange.filter((d) => d >= windowStart && d <= windowEnd).length;
    missed += Math.max(0, required - count);
    totalRequired += required;
  }
  return { missed, completed: inRange.length, required: totalRequired };
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
        const sparesSnap = await t.get(challengeDoc.ref.collection("spares"));

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

        // Spares the member deliberately committed to this cycle's missed
        // weeks. Summed rather than matched to windows: the outcome compares
        // totals (`missed <= base + applied`), and sparesConsumed already
        // stops more being burnt than the misses called for — so which week
        // each one names matters to the history, not to the arithmetic.
        const sparesByUid = new Map<string, number>();
        for (const doc of sparesSnap.docs) {
          const { uid, count } = doc.data() as SpareData;
          sparesByUid.set(uid, (sparesByUid.get(uid) ?? 0) + Math.max(0, count));
        }

        // Declared time off, read from each member's profile. One getAll for
        // the whole challenge rather than a read per member, and it happens
        // here — with the other reads — because a transaction admits no read
        // after its first write.
        //
        // Read now rather than snapshotted when the range was declared: the
        // advance-notice rule (lib/server/away-admin.ts) is what makes that
        // safe. A range can't be added once it has started and can't be
        // removed once it has, so what this sees for any day already past is
        // exactly what was declared before that day began.
        const memberUids = membersSnap.docs.map((doc) => doc.id);
        const timeOffByUid = new Map<string, CycleTimeOff>();
        if (memberUids.length > 0) {
          const userSnaps = await t.getAll(
            ...memberUids.map((uid) => db.collection("users").doc(uid))
          );
          for (const snap of userSnaps) {
            const ranges =
              (snap.data()?.awayRanges as AwayRange[] | undefined) ?? [];
            const memberData = membersSnap.docs
              .find((d) => d.id === snap.id)
              ?.data() as MemberData | undefined;
            timeOffByUid.set(
              snap.id,
              memberTimeOff(
                challenge,
                ranges,
                memberData?.joinedDate,
                // The creator's exclusion is read here rather than branched on
                // later: it resolves to a cycle-wide step-out, so everything
                // downstream — the requirement, the misses, the ledger — is
                // the path that already exists and is already tested.
                memberData?.excluded === true
              )
            );
          }
        }

        const adjudicatedAt = Timestamp.fromDate(now);
        const graded: MemberOutcome[] = [];
        const memberUpdates: {
          ref: FirebaseFirestore.DocumentReference;
          missed: number;
          completed: number;
          succeeded: boolean;
          allowance: {
            base: number;
            carried: number;
            earned: number;
            applied: number;
            available: number;
            total: number;
          };
          /** Applied spares this result actually burnt. */
          spent: number;
          /** Booked so much of this cycle off that they sat it out. */
          steppedOut: boolean;
          /** ...or the creator excused them, which lands in the same place. */
          excluded: boolean;
          /** ...or the cycle asked them for nothing at all. */
          askedNothing: boolean;
        }[] = [];
        for (const memberDoc of membersSnap.docs) {
          const member = memberDoc.data() as MemberData;
          const uid = memberDoc.id;
          const ymds = checkinsByUid.get(uid) ?? [];
          const timeOff = timeOffByUid.get(uid);
          const away = timeOff?.days;
          const { missed, completed, required } = computeMissed(
            challenge,
            ymds,
            member.joinedDate,
            away
          );
          // Spare skips are earned a week at a time and spent deliberately:
          // only the ones committed to a missed week of this cycle count
          // toward the allowance. Whatever is left in the balance is not lost
          // — it rolls onto the successor below, and stays there until it is
          // used.
          //
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
            member.badgesCarried,
            sparesByUid.get(uid) ?? 0,
            away
          );
          const succeeded = missed <= allowance.total;
          const spent = sparesConsumed(missed, allowance.base, allowance.applied);
          // The creator's exclusion already resolved to a cycle-wide step-out
          // in memberTimeOff above, so `steppedOut` covers both routes out —
          // and `stakedMembers` below drops them from the money in one place
          // rather than at each branch of the ledger.
          const steppedOut = timeOff?.steppedOut === true;
          const excluded = member.excluded === true;
          // Asked for nothing, so not paid for nothing. `missed` is 0 both for
          // someone who did everything the cycle asked and for someone it
          // never asked anything of — a member who joined the day it ended,
          // or whose only days as a member were excused — and `succeeded`
          // could not tell them apart. In a pool that difference is a full
          // share of everyone else's forfeits handed to somebody who was not
          // there. Zero required is the one signal that separates them.
          const askedNothing = required === 0 && !steppedOut;
          graded.push({
            uid,
            displayName: member.displayName,
            username: member.username ?? null,
            charityName: member.charityName ?? null,
            succeeded,
            steppedOut,
            askedNothing,
          });
          // Deferred to after the venmo reads below — transactions require
          // every read to happen before the first write.
          memberUpdates.push({
            ref: memberDoc.ref,
            missed,
            completed,
            succeeded,
            allowance,
            spent,
            steppedOut,
            excluded,
            askedNothing,
          });
        }

        // Everyone the stake actually applies to — see stakes.ts. Anyone who
        // sat the cycle out or was excused from it is gone from here, and
        // every money decision below is built from this list alone.
        const staked = stakedMembers(graded);

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
          const winnerUids = staked.filter((o) => o.succeeded).map((o) => o.uid);
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
        // the balance it copied forward was the pre-grading one. Now that the
        // final weeks are graded, correct it — otherwise a habit that repeats
        // itself quietly loses every spare earned in its last cycle, which is
        // the one people are most likely to have been counting on. The
        // correction runs in both directions: the final week may have earned
        // one, and applied spares that grading turned out not to need are
        // handed back here rather than burnt.
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
          // Everything banked, plus everything this cycle earned, less only
          // what this cycle actually spent — which is what makes a spare last
          // "until you use it" rather than until the cycle happens to end.
          const balance =
            update.allowance.carried + update.allowance.earned - update.spent;
          if (successorRef && successorMemberIds.has(update.ref.id)) {
            t.update(successorRef.collection("members").doc(update.ref.id), {
              badgesCarried: balance,
            });
          }
          t.update(update.ref, {
            // "stepped-out" rather than null: null is a cycle still running,
            // and a member row that reverts to looking un-graded once results
            // are in reads as a bug rather than as an arrangement.
            // "stepped-out" covers askedNothing too: the member-facing
            // meaning is identical — not graded, no stake either way — and it
            // is the only honest thing to write for someone the cycle never
            // asked anything of. Recording "succeeded" would put a tick beside
            // a cycle they took no part in, and "failed" would bill them for
            // one.
            outcome: update.excluded
              ? "excluded"
              : update.steppedOut || update.askedNothing
                ? "stepped-out"
                : update.succeeded
                  ? "succeeded"
                  : "failed",
            steppedOut: update.steppedOut || update.askedNothing,
            completedCount: update.completed,
            skipsUsed: Math.min(update.missed, update.allowance.total),
            // Frozen alongside the outcome so a result can always be explained
            // later, even if the badge rules change underneath it.
            badgesEarned: update.allowance.earned,
            badgesSpent: update.spent,
            skipsAllowed: update.allowance.total,
            // What a repeat of this habit starts with (repeatChallengeAdmin).
            badgesCarried: balance,
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

        // Who owes whom, decided in stakes.ts where it can be tested over
        // fixtures — including the case this is written for, a cycle with an
        // excused member in it. An empty list is a legitimate result (nobody
        // failed; or in a pool, nobody succeeded, which is a wash) and
        // execution still falls through so the challenge is marked graded.
        for (const draft of ledgerDrafts(staked, challenge, venmoByUid)) {
          t.set(db.collection("ledgerEntries").doc(), {
            ...baseEntry,
            ...draft,
          });
        }

        // Runs for every processed challenge, including zero-ledger ones —
        // an early return above this point would re-process forever.
        t.update(challengeDoc.ref, { status: "adjudicated", adjudicatedAt });

        // Every member, not just the graded ones: someone who sat the cycle
        // out is still in the habit and still wants to know it finished. They
        // are absent from `staked` because that list builds the ledger, and
        // reusing it here would have quietly made "no stake" mean "no news".
        notifyMemberUids = memberUpdates.map((u) => u.ref.id);
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
