import { initializeApp } from "firebase-admin/app";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { adjudicateEndedChallenges } from "./adjudicate";
import { sendDailyLifecycleNotifications } from "./lifecycle";
import {
  ledgerCreatedContent,
  sendPush,
  sendPushToMany,
} from "./notifications";

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

/** Hourly; delivers 9am-local lifecycle nudges (docs/06). */
export const dailylifecyclenotifications = onSchedule(
  { schedule: "0 * * * *", timeZone: "UTC", region: "us-central1" },
  async () => {
    await sendDailyLifecycleNotifications(new Date());
  }
);

/** New debt → notify the debtor (and the creditor for user-to-user). */
export const onledgerentrycreate = onDocumentCreated(
  { document: "ledgerEntries/{entryId}", region: "us-central1" },
  async (event) => {
    const entry = event.data?.data();
    if (!entry) return;
    const content = ledgerCreatedContent({
      challengeName: entry.challengeName,
      amount: entry.amount,
      toType: entry.toType,
      toName: entry.toName ?? null,
      toCharityName: entry.toCharityName ?? null,
    });
    await sendPush(entry.fromUid, content.debtor);
    if (content.creditor && entry.toUid) {
      await sendPush(entry.toUid, content.creditor);
    }
  }
);

/** Debt settled → notify the creditor (user-to-user only). */
export const onledgerentrysettle = onDocumentUpdated(
  { document: "ledgerEntries/{entryId}", region: "us-central1" },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.status !== "unsettled" || after.status !== "settled") return;
    if (after.toType !== "user" || !after.toUid) return;
    await sendPush(after.toUid, {
      title: "Debt settled",
      body: `${after.fromName} marked their debt from "${after.challengeName}" as settled.`,
      targetUrl: `/ledger/${event.params.entryId}`,
      category: "ledger",
    });
  }
);

/** Someone joined a group challenge → notify the other members. */
export const onmemberjoin = onDocumentCreated(
  { document: "challenges/{cid}/members/{uid}", region: "us-central1" },
  async (event) => {
    const member = event.data?.data();
    if (!member) return;

    const challengeSnap = await event.data!.ref.parent.parent!.get();
    const challenge = challengeSnap.data();
    if (!challenge || challenge.mode !== "group") return;
    // The creator's own member doc is written at creation — not a "join".
    if (event.params.uid === challenge.createdBy) return;

    const others = ((challenge.memberIds as string[]) ?? []).filter(
      (uid) => uid !== event.params.uid
    );
    await sendPushToMany(others, {
      title: "New member",
      body: `${member.displayName} joined "${challenge.name}".`,
      targetUrl: `/challenges/${challengeSnap.id}`,
      category: "groupActivity",
    });
  }
);
