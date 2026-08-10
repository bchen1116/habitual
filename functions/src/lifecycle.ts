import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { sendPush } from "./notifications";
import { addDaysYmd } from "./dates";
import { awayDaysFor, type AwayRange } from "./away";
import { spareNudgeBody, spareShortfall } from "./spare-nudge";
import {
  currentWindow,
  needsCheckinToday,
  reminderContent,
  reminderHourFor,
  type ReminderChallenge,
} from "./reminders";

/** The user's current hour (0-23) in their IANA timezone. */
function localHour(now: Date, timeZone: string): number | null {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        hour12: false,
        hourCycle: "h23",
      }).format(now)
    );
  } catch {
    return null; // bad timezone string — skip the user
  }
}

/** The user's current calendar date in their timezone, as yyyymmdd. */
function localYmd(now: Date, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(now)
      .replaceAll("-", "");
  } catch {
    return null;
  }
}

/**
 * Runs hourly, and does two things off the same pass over push-enabled users
 * so their timezone and challenge list are only read once:
 *
 * - At 09:xx local, the lifecycle nudges — challenges starting today, and
 *   last-day pending check-ins (docs/06).
 * - At the user's own reminder hour (default 22:00 local, changeable in
 *   Settings), one nudge covering everything still unchecked before their day
 *   ends. This is the moment that actually matters: at midnight *in their
 *   timezone* the day closes and each habit is fixed as done or missed, so
 *   the reminder is anchored to that boundary rather than to a server hour.
 *
 * Timezones offset by 30 or 45 minutes (India, Nepal, Chatham) get theirs at
 * :30 or :45 past, since the schedule fires on the UTC hour. Each still maps
 * to exactly one local hour per day, so nobody is nudged twice or skipped.
 */
export async function sendDailyLifecycleNotifications(now: Date): Promise<void> {
  const db = getFirestore();
  let users: FirebaseFirestore.QuerySnapshot;
  try {
    users = await db.collection("users").where("fcmToken", "!=", null).get();
  } catch (err) {
    // Unguarded, this aborted the ENTIRE hourly run on a single transient
    // failure — every timezone whose local hour is 9 right now gets no
    // lifecycle nudge at all, with no retry (this trigger doesn't set
    // retry: true) and no way to recover since next hour targets a
    // different timezone cohort. Log and skip this run instead.
    logger.error("lifecycle notifications: couldn't list users", err);
    return;
  }

  for (const userDoc of users.docs) {
    const user = userDoc.data();
    const timeZone = (user.timezone as string | undefined) ?? "UTC";
    const hour = localHour(now, timeZone);
    const isLifecycleHour = hour === 9;
    const isReminderHour = hour === reminderHourFor(user.reminderHour);
    if (!isLifecycleHour && !isReminderHour) continue;
    const today = localYmd(now, timeZone);
    if (!today) continue;

    try {
      const challenges = await db
        .collection("challenges")
        .where("memberIds", "array-contains", userDoc.id)
        .where("status", "==", "active")
        .get();

      if (isLifecycleHour) {
        for (const challengeDoc of challenges.docs) {
          const challenge = challengeDoc.data();

          if (challenge.startDate === today) {
            await sendPush(userDoc.id, {
              title: "Challenge starts today",
              body: `"${challenge.name}" begins — day one is today.`,
              targetUrl: `/challenges/${challengeDoc.id}`,
              category: "challengeLifecycle",
            });
          }

          if (challenge.endDate === today) {
            const checkin = await challengeDoc.ref
              .collection("checkins")
              .doc(`${today}_${userDoc.id}`)
              .get();
            if (!checkin.exists) {
              await sendPush(userDoc.id, {
                title: "Last day!",
                body: `Final check-in for "${challenge.name}" — don't lose your stake now.`,
                targetUrl: `/challenges/${challengeDoc.id}`,
                category: "challengeLifecycle",
              });
            }
          }

          // The morning after a cycle ends, while it waits out the
          // adjudication buffer: the last moment a banked spare can still
          // save the stake, and the first at which the shortfall is final.
          // See spare-nudge.ts — it returns null unless spending the balance
          // would actually change the outcome, which is nearly always.
          if (addDaysYmd(challenge.endDate, 1) === today) {
            const shortfall = await spareShortfall(
              challengeDoc.ref,
              challenge as Parameters<typeof spareShortfall>[1],
              userDoc.id,
              today,
              user.awayRanges as AwayRange[] | undefined
            );
            if (shortfall) {
              await sendPush(userDoc.id, {
                title: "A spare skip can still save this",
                body: spareNudgeBody(challenge.name, shortfall),
                targetUrl: `/challenges/${challengeDoc.id}`,
                category: "challengeLifecycle",
              });
            }
          }
        }
      }

      if (isReminderHour) {
        await sendCheckinReminder(userDoc, challenges.docs, today);
      }
    } catch (err) {
      logger.warn(`lifecycle notifications failed for user ${userDoc.id}`, err);
    }
  }
}

/**
 * One evening push covering every habit still unchecked, or none at all.
 *
 * `lastReminderYmd` makes it idempotent per local day: this trigger sets no
 * `retry`, but a redelivery or an overlapping run would otherwise buzz twice
 * for the same evening, and a reminder that double-fires is one people
 * silence rather than re-configure.
 */
async function sendCheckinReminder(
  userDoc: FirebaseFirestore.QueryDocumentSnapshot,
  challengeDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  today: string
): Promise<void> {
  if (userDoc.data().lastReminderYmd === today) return;

  const outstanding: { name: string; urgent: boolean }[] = [];
  let onlyChallengeId: string | null = null;

  for (const challengeDoc of challengeDocs) {
    const data = challengeDoc.data();
    const challenge: ReminderChallenge = {
      id: challengeDoc.id,
      name: data.name,
      frequency: data.frequency,
      startDate: data.startDate,
      endDate: data.endDate,
    };

    // Only this member's current window is needed. Filtering by localDate
    // alone keeps it on the auto-created single-field index — a uid equality
    // plus a date range would need a composite one deployed first, and a
    // week of a group's check-ins is small enough to filter in memory.
    const window = currentWindow(challenge, today);
    if (!window) continue;
    const snap = await challengeDoc.ref
      .collection("checkins")
      .where("localDate", ">=", window.start)
      .where("localDate", "<=", window.end)
      .get();
    const mine = snap.docs
      .map((d) => d.data())
      .filter((c) => c.uid === userDoc.id)
      .map((c) => c.localDate as string);

    const memberSnap = await challengeDoc.ref
      .collection("members")
      .doc(userDoc.id)
      .get();

    const joinedDate = memberSnap.data()?.joinedDate as string | undefined;
    const verdict = needsCheckinToday(
      challenge,
      joinedDate,
      today,
      mine,
      // Already in hand from the pass over push-enabled users, so declared
      // time off costs this loop no extra read.
      awayDaysFor(
        data as { startDate: string; endDate: string },
        userDoc.data().awayRanges as AwayRange[] | undefined,
        joinedDate
      )
    );
    if (!verdict.needed) continue;
    outstanding.push({ name: challenge.name, urgent: verdict.urgent });
    onlyChallengeId = outstanding.length === 1 ? challengeDoc.id : null;
  }

  const content = reminderContent(outstanding);
  if (!content) return;

  await sendPush(userDoc.id, {
    ...content,
    targetUrl: onlyChallengeId ? `/challenges/${onlyChallengeId}` : "/dashboard",
    category: "dailyReminder",
  });
  await userDoc.ref.update({ lastReminderYmd: today });
}
