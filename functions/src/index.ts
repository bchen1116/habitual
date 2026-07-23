import { initializeApp } from "firebase-admin/app";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { adjudicateEndedChallenges } from "./adjudicate";

initializeApp();

/**
 * Daily at 03:00 UTC (docs/03). The 36-hour cutoff inside guarantees no
 * member is graded before their final local day has ended in any timezone.
 */
export const adjudicateendedchallenges = onSchedule(
  { schedule: "0 3 * * *", timeZone: "UTC", region: "us-central1" },
  async () => {
    const processed = await adjudicateEndedChallenges(new Date());
    logger.info(`Adjudicated ${processed} challenge(s)`);
  }
);
