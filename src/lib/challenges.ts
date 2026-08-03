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
  joinPolicy: "open" | "invite"; // group only; ignored for solo
  frequencyType: FrequencyType;
  target: number;
  startDate: string; // yyyymmdd
  durationDays: number; // whole weeks: 7 / 14 / 21 / 28
  skipDays: number;
  stakeAmount: number;
  charityName: string | null; // null in pool mode
  visibility: "public" | "private";
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

export type JoinChallengeResult =
  | { status: "joined"; challengeId: string }
  | { status: "pending" };

/**
 * Joins a group challenge by code. On an open group this grants membership
 * immediately; on an invite-only group it files a request instead, and the
 * result comes back as "pending" rather than a challenge id to redirect to.
 */
export async function joinChallenge(
  joinCode: string,
  charityName: string | null
): Promise<JoinChallengeResult> {
  const response = await fetch("/api/challenges/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ joinCode, charityName }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Couldn't join the challenge");
  }
  return body as JoinChallengeResult;
}

/** Creator-only: approve or reject a pending join request on an invite-only group. */
export async function respondToJoinRequest(
  challengeId: string,
  uid: string,
  action: "approve" | "reject"
): Promise<void> {
  const response = await fetch(`/api/challenges/${challengeId}/requests/${uid}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Couldn't respond to that request");
  }
}

/**
 * Creator-only: opens or closes new joins on a group challenge. Not tied to
 * the start date — joining stays open through the whole run until the
 * creator explicitly closes it here.
 */
export async function setJoinClosed(challengeId: string, closed: boolean): Promise<void> {
  const response = await fetch(`/api/challenges/${challengeId}/join-lock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ closed }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Couldn't update joining for this challenge");
  }
}

/**
 * Creator-only: whether this habit counts toward the public leaderboard.
 * Available for the whole active life of the habit, including after friends
 * have joined — unlike the money-term edits in `editChallenge`.
 */
export async function setChallengeVisibility(
  challengeId: string,
  visibility: "public" | "private"
): Promise<void> {
  const response = await fetch(`/api/challenges/${challengeId}/visibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Couldn't update this habit's visibility");
  }
}

/** Creator-only: removes a member from an active group challenge. */
export async function removeMember(challengeId: string, uid: string): Promise<void> {
  const response = await fetch(`/api/challenges/${challengeId}/members/${uid}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Couldn't remove that member");
  }
}

export interface EditChallengeInput {
  stakeAmount: number;
  endDate: string; // yyyymmdd
  skipDays: number;
}

export interface EditChallengeResult {
  streakEnded: boolean;
}

/**
 * Creator-only: adjust stake/duration/skip days. Only allowed while a
 * group challenge still has just its creator as a member (terms are
 * frozen once anyone else has joined, same rule the app already applies
 * elsewhere) — solo challenges have no such restriction.
 */
export async function editChallenge(
  challengeId: string,
  input: EditChallengeInput
): Promise<EditChallengeResult> {
  const response = await fetch(`/api/challenges/${challengeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Couldn't update the challenge");
  }
  return body as EditChallengeResult;
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
 * No dates: the next cycle's start and end are derived server-side from the
 * cycle being repeated, so there is nothing here for the client's clock to
 * disagree with the server's about.
 */
export interface RepeatChallengeInput {
  stakeAmount: number;
  skipDays: number;
}

export interface RepeatChallengeResult {
  id: string;
  joinCode: string | null;
}

/**
 * Creator-only: starts a new cycle of an ended habit with the same name,
 * mode, and frequency; stake/end-date/skip-days can be adjusted. For group
 * habits, every prior member carries into the new cycle automatically.
 */
export async function repeatChallenge(
  challengeId: string,
  input: RepeatChallengeInput
): Promise<RepeatChallengeResult> {
  const response = await fetch(`/api/challenges/${challengeId}/repeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Couldn't repeat this habit");
  }
  return body as RepeatChallengeResult;
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
