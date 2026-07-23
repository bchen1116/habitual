"use client";

import {
  collection,
  doc,
  query,
  serverTimestamp,
  updateDoc,
  setDoc,
  where,
  writeBatch,
  type Firestore,
  type Query,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { getClientDb } from "@/lib/firebase/client";
import { addDaysYmd } from "@/lib/dates";
import type { Challenge, FrequencyType } from "@/lib/types";

export interface CreateChallengeInput {
  name: string;
  description: string;
  frequencyType: FrequencyType;
  target: number;
  startDate: string; // yyyymmdd
  durationDays: number; // whole weeks: 7 / 14 / 21 / 28
  skipDays: number;
  stakeAmount: number;
  charityName: string;
}

/** Active challenges the user belongs to (dashboard query). */
export function activeChallengesQuery(db: Firestore, uid: string): Query {
  return query(
    collection(db, "challenges"),
    where("memberIds", "array-contains", uid),
    where("status", "==", "active")
  );
}

/**
 * Creates the challenge doc + the creator's member doc in one batch.
 * (Step 4 moves this into a `createChallenge` Cloud Function when group
 * mode and join codes arrive; for solo, client-side writes are fine.)
 */
export async function createChallenge(
  user: User,
  input: CreateChallengeInput
): Promise<string> {
  const db = getClientDb();
  const challengeRef = doc(collection(db, "challenges"));
  const memberRef = doc(db, "challenges", challengeRef.id, "members", user.uid);

  const endDate = addDaysYmd(input.startDate, input.durationDays - 1);

  const batch = writeBatch(db);
  batch.set(challengeRef, {
    name: input.name,
    description: input.description || null,
    createdBy: user.uid,
    mode: "solo",
    forfeitType: "charity",
    charityName: input.charityName,
    frequency: {
      type: input.frequencyType,
      target: input.frequencyType === "daily" ? 1 : input.target,
    },
    skipDays: input.skipDays,
    stakeAmount: input.stakeAmount,
    startDate: input.startDate,
    endDate,
    status: "active",
    memberIds: [user.uid],
    createdAt: serverTimestamp(),
  });
  batch.set(memberRef, {
    displayName: user.displayName ?? user.email ?? "Anonymous",
    joinedAt: serverTimestamp(),
    charityName: input.charityName,
    outcome: null,
    completedCount: 0,
    skipsUsed: 0,
  });
  await batch.commit();
  return challengeRef.id;
}

/** Creator-only, before startDate (enforced by Firestore rules). */
export async function cancelChallenge(challengeId: string): Promise<void> {
  const db = getClientDb();
  await updateDoc(doc(db, "challenges", challengeId), { status: "cancelled" });
}

/**
 * Check in for a local date. The doc ID (`<localDate>_<uid>`) enforces
 * one-per-day; rules verify the ID shape, the server timestamp, and that
 * localDate is within ±1 day of server time.
 *
 * Note: an offline check-in that syncs more than a day later will be
 * rejected by that ±1-day rule — accepted trade-off (docs/02) to prevent
 * backfilling missed days.
 */
export function checkIn(
  challenge: Challenge,
  uid: string,
  localDate: string,
  note: string
): Promise<void> {
  const db = getClientDb();
  const ref = doc(db, "challenges", challenge.id, "checkins", `${localDate}_${uid}`);
  return setDoc(ref, {
    uid,
    localDate,
    completedAt: serverTimestamp(),
    note: note.trim() || null,
  });
}
