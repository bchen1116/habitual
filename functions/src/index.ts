import { initializeApp } from "firebase-admin/app";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { adjudicateEndedChallenges } from "./adjudicate";
import { autoRepeatEndingChallenges } from "./auto-repeat";
import { sendDailyLifecycleNotifications } from "./lifecycle";
import {
  ledgerCreatedContent,
  sendPush,
  sendPushToMany,
} from "./notifications";

initializeApp();

/**
 * Hourly. What protects a member from being graded early is the 39-hour
 * cutoff inside (ADJUDICATION_BUFFER_HOURS), never the schedule — the query
 * simply finds nothing until that buffer is satisfied.
 *
 * This used to run once daily at 03:00 UTC, and the two didn't line up. The
 * buffer first admits a habit ending on the 2nd at 15:00 UTC on the 3rd,
 * which is twelve hours *after* that day's run has been and gone, so every
 * result waited for the following day's — a flat 12 hours of nothing
 * happening, on top of the buffer that had already done its job. Someone in
 * US Eastern waited 20 hours past their own last chance to check in; in
 * Tokyo, 33.
 *
 * Polling hourly costs 23 extra runs a day of one indexed query that returns
 * nothing, and it can't grade anything early, because the buffer is what
 * decides that.
 *
 * Both passes are safe to repeat, which is what makes the frequency a free
 * choice: adjudication only selects status == "active" and flips it inside a
 * transaction, and auto-repeat claims its successor slot with a
 * compare-and-set on repeatedToId, re-checking both conditions inside the
 * transaction.
 *
 * Auto-repeat runs first, and the order is not incidental: it only considers
 * challenges still marked active, so grading a cycle before looking at it
 * would make its successor invisible to this run. The two operate a day or
 * more apart in practice (one looks ~24h ahead of an end date, the other ~39h
 * behind it), but the ordering makes that a property rather than a hope.
 */
export const adjudicateendedchallenges = onSchedule(
  { schedule: "0 * * * *", timeZone: "UTC", region: "us-central1" },
  async () => {
    const now = new Date();
    try {
      const repeated = await autoRepeatEndingChallenges(now);
      logger.info(`Auto-repeated ${repeated} challenge(s)`);
    } catch (err) {
      // Never let this stop adjudication: money settlement is the job that
      // must not be skipped, and a missed auto-repeat retries tomorrow.
      logger.error("Auto-repeat pass failed", err);
    }
    const processed = await adjudicateEndedChallenges(now);
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
