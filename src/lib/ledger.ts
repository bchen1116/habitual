"use client";

import {
  collection,
  doc,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
  type Query,
} from "firebase/firestore";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from "firebase/storage";
import { getClientDb } from "@/lib/firebase/client";

/** Entries where the user is the debtor ("I owe"). */
export function owedByMeQuery(db: Firestore, uid: string): Query {
  return query(collection(db, "ledgerEntries"), where("fromUid", "==", uid));
}

/** Entries where the user is the creditor ("I'm owed"; user-to-user only). */
export function owedToMeQuery(db: Firestore, uid: string): Query {
  return query(collection(db, "ledgerEntries"), where("toUid", "==", uid));
}

/**
 * Uploads a receipt image; returns its download URL. Path must match the
 * Storage rules: receipts/{uid}/{entryId}.
 */
export function uploadReceipt(
  uid: string,
  entryId: string,
  file: File,
  onProgress: (fraction: number) => void
): { task: UploadTask; url: Promise<string> } {
  const storageRef = ref(getStorage(), `receipts/${uid}/${entryId}`);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type,
  });
  const url = new Promise<string>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => onProgress(snap.bytesTransferred / snap.totalBytes),
      reject,
      () => getDownloadURL(task.snapshot.ref).then(resolve, reject)
    );
  });
  return { task, url };
}

/**
 * Marks an entry settled. Rules enforce: debtor only, one-way, settledAt =
 * server time. Receipt (if any) must be uploaded first so its URL rides in
 * the same update.
 */
export async function settleEntry(
  entryId: string,
  options: { receiptURL?: string; note?: string }
): Promise<void> {
  const db = getClientDb();
  await updateDoc(doc(db, "ledgerEntries", entryId), {
    status: "settled",
    settledAt: serverTimestamp(),
    ...(options.receiptURL ? { receiptURL: options.receiptURL } : {}),
    ...(options.note?.trim() ? { note: options.note.trim() } : {}),
  });
}
