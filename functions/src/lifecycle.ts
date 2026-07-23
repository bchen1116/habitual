import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { sendPush } from "./notifications";

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
 * Runs hourly; for every push-enabled user whose local time is 09:xx,
 * nudges about challenges starting today and last-day pending check-ins
 * (docs/06 — "ending in 24 hours with pending check-ins", interpreted as
 * a 9am nudge on the final day when today's check-in is still missing).
 */
export async function sendDailyLifecycleNotifications(now: Date): Promise<void> {
  const db = getFirestore();
  const users = await db.collection("users").where("fcmToken", "!=", null).get();

  for (const userDoc of users.docs) {
    const user = userDoc.data();
    const timeZone = (user.timezone as string | undefined) ?? "UTC";
    if (localHour(now, timeZone) !== 9) continue;
    const today = localYmd(now, timeZone);
    if (!today) continue;

    try {
      const challenges = await db
        .collection("challenges")
        .where("memberIds", "array-contains", userDoc.id)
        .where("status", "==", "active")
        .get();

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
      }
    } catch (err) {
      logger.warn(`lifecycle notifications failed for user ${userDoc.id}`, err);
    }
  }
}
