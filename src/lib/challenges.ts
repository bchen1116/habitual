"use client";

import {
  collection,
  doc,
  query,
  serverTimestamp,
  updateDoc,
  setDoc,
  where,
  type Firestore,
  type Query,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import type { Challenge, FrequencyType } from "@/lib/types";

export interface CreateChallengeInput {
  name: string;
  description: string;
  mode: "solo" | "group";
  forfeitType: "charity" | "pool";
  maxMembers: number | null;
  frequencyType: FrequencyType;
  target: number;
  startDate: string; // yyyymmdd
  durationDays: number; // whole weeks: 7 / 14 / 21 / 28
  skipDays: number;
  stakeAmount: number;
  charityName: string | null; // null in pool mode
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
 * Every challenge the user has ever completed (lifetime stats). Uses the
 * same `memberIds` + `status` composite index as activeChallengesQuery —
 * Firestore composite indexes are defined by field, not by the specific
 * value filtered on, so no new index is needed for the different status.
 */
export function completedChallengesQuery(db: Firestore, uid: string): Query {
  return query(
    collection(db, "challenges"),
    where("memberIds", "array-contains", uid),
    where("status", "==", "adjudicated")
  );
}

/**
 * Creates a challenge via the server (join codes need server-side collision
 * checks, and the rules block client challenge writes). Identity comes from
 * the session cookie. Requires network — creation isn't an offline flow.
 */
export async function createChallenge(
  input: CreateChallengeInput
): Promise<string> {
  const response = await fetch("/api/challenges", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Couldn't create the challenge");
  }
  return body.id as string;
}

/** Joins a group challenge by code; resolves to the challenge id. */
export async function joinChallenge(
  joinCode: string,
  charityName: string | null
): Promise<string> {
  const response = await fetch("/api/challenges/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ joinCode, charityName }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Couldn't join the challenge");
  }
  return body.challengeId as string;
}

/** Creator-only, before startDate (enforced by Firestore rules). */
export async function cancelChallenge(challengeId: string): Promise<void> {
  const db = getClientDb();
  await updateDoc(doc(db, "challenges", challengeId), { status: "cancelled" });
}

/**
 * Permanently deletes a solo challenge (creator-only, any status) via the
 * server — recursive subcollection deletes aren't available to the client
 * SDK, and the rules block client-side challenge deletes outright.
 */
export async function deleteChallenge(challengeId: string): Promise<void> {
  const response = await fetch(`/api/challenges/${challengeId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Couldn't delete the challenge");
  }
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
