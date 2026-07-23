import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import * as logger from "firebase-functions/logger";

export type NotificationCategory =
  | "groupActivity"
  | "challengeLifecycle"
  | "ledger";

interface PushContent {
  title: string;
  body: string;
  targetUrl: string;
  category: NotificationCategory;
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Sends one push to one user, honoring their notificationPrefs. Missing
 * prefs mean enabled (defaults-on). Skips silently when there's no token;
 * clears tokens FCM reports as dead.
 */
export async function sendPush(uid: string, content: PushContent): Promise<void> {
  const db = getFirestore();
  const userSnap = await db.collection("users").doc(uid).get();
  const user = userSnap.data();
  if (!user) return;

  const token = user.fcmToken as string | undefined | null;
  if (!token) return;

  const prefs = (user.notificationPrefs ?? {}) as Partial<
    Record<NotificationCategory, boolean>
  >;
  if (prefs[content.category] === false) return;

  try {
    await getMessaging().send({
      token,
      webpush: {
        notification: {
          title: content.title,
          body: content.body,
        },
        data: { targetUrl: content.targetUrl },
      },
      data: { targetUrl: content.targetUrl },
    });
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      await userSnap.ref.update({ fcmToken: null }).catch(() => {});
    } else {
      logger.warn(`push to ${uid} failed`, err);
    }
  }
}

export async function sendPushToMany(
  uids: string[],
  content: PushContent
): Promise<void> {
  await Promise.all(uids.map((uid) => sendPush(uid, content)));
}

export function ledgerCreatedContent(entry: {
  challengeName: string;
  amount: number;
  toType: string;
  toName: string | null;
  toCharityName: string | null;
}): { debtor: PushContent; creditor: PushContent | null } {
  const counterparty =
    entry.toType === "charity"
      ? (entry.toCharityName ?? "charity")
      : (entry.toName ?? "someone");
  return {
    debtor: {
      title: "Results are in",
      body: `You owe ${formatAmount(entry.amount)} to ${counterparty} from "${entry.challengeName}".`,
      targetUrl: "/ledger?tab=owe",
      category: "ledger",
    },
    creditor:
      entry.toType === "user"
        ? {
            title: "Someone owes you",
            body: `${formatAmount(entry.amount)} coming your way from "${entry.challengeName}".`,
            targetUrl: "/ledger?tab=owed",
            category: "ledger",
          }
        : null,
  };
}
