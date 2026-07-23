import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

/**
 * Account deletion cascade (docs/07). Ledger entries are anonymized, not
 * deleted — other users' totals depend on them. A departed member is
 * excluded from future adjudication entirely: their member doc and
 * check-ins are removed, so the grader never sees them.
 */
export async function deleteAccountAdmin(uid: string): Promise<void> {
  const db = getAdminDb();

  // 1. Every challenge the user belongs to, in any state.
  const challenges = await db
    .collection("challenges")
    .where("memberIds", "array-contains", uid)
    .get();

  for (const challengeDoc of challenges.docs) {
    const data = challengeDoc.data();
    // One batch per challenge so removal is atomic — a partial write must
    // never leave a member doc behind for the grader without a matching
    // memberIds entry.
    const batch = db.batch();

    if (data.status === "active") {
      const memberIds = (data.memberIds as string[]) ?? [];
      if (memberIds.length <= 1) {
        // Sole member (all solo challenges, plus group ones nobody joined):
        // cancel rather than leave an empty challenge for the grader.
        batch.update(challengeDoc.ref, { status: "cancelled" });
      } else {
        batch.update(challengeDoc.ref, {
          memberIds: FieldValue.arrayRemove(uid),
        });
      }
      batch.delete(challengeDoc.ref.collection("members").doc(uid));

      const checkins = await challengeDoc.ref
        .collection("checkins")
        .where("uid", "==", uid)
        .get();
      checkins.docs.forEach((d) => batch.delete(d.ref));
    } else {
      // Ended / adjudicated / cancelled: the record stays for the other
      // members, but the identity is scrubbed.
      batch.set(
        challengeDoc.ref.collection("members").doc(uid),
        { displayName: "Deleted user" },
        { merge: true }
      );
    }

    await batch.commit();
  }

  // 2. Anonymize ledger entries in both directions; amounts and status stay.
  const [debts, credits] = await Promise.all([
    db.collection("ledgerEntries").where("fromUid", "==", uid).get(),
    db.collection("ledgerEntries").where("toUid", "==", uid).get(),
  ]);
  await Promise.all([
    ...debts.docs.map((d) => d.ref.update({ fromName: "Deleted user" })),
    ...credits.docs.map((d) => d.ref.update({ toName: "Deleted user" })),
  ]);

  // 3. Uploaded files (receipts, avatar). Best-effort — a missing bucket
  // or prefix must not block deletion.
  try {
    const bucket = getStorage().bucket();
    await bucket.deleteFiles({ prefix: `receipts/${uid}/` });
    await bucket.deleteFiles({ prefix: `avatars/${uid}` });
  } catch (err) {
    console.error("storage cleanup failed during account deletion:", err);
  }

  // 4. The user doc, then the auth account (re-signup with the same email
  // creates a fresh account).
  await db.collection("users").doc(uid).delete();
  await getAdminAuth().deleteUser(uid);
}
