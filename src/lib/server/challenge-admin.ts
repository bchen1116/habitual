import "server-only";

import {
  FieldValue,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * Server-side challenge creation and joining. Docs/04 specifies callable
 * Cloud Functions; these run as authenticated Next.js route handlers
 * instead — same trust level (Admin SDK behind session verification), one
 * less deploy surface, no CORS. The rules block client writes either way.
 */

// Excludes I, O, 0, 1, and L for readability when typed or read aloud.
const JOIN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 6;

export function yyyymmddUTC(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${d}`;
}

function randomJoinCode(): string {
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_ALPHABET[Math.floor(Math.random() * JOIN_ALPHABET.length)];
  }
  return code;
}

/** Unique among ACTIVE challenges only (docs/04); reusable after a challenge ends. */
async function generateUniqueJoinCode(): Promise<string> {
  const db = getAdminDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomJoinCode();
    const clash = await db
      .collection("challenges")
      .where("joinCode", "==", code)
      .where("status", "==", "active")
      .limit(1)
      .get();
    if (clash.empty) return code;
  }
  throw new Error("Could not generate a unique join code");
}

export interface CreateChallengePayload {
  name: string;
  description: string;
  mode: "solo" | "group";
  forfeitType: "charity" | "pool"; // pool only valid for group
  maxMembers: number | null;
  joinPolicy: "open" | "invite"; // group only; ignored for solo
  frequencyType: "daily" | "weekly_count";
  target: number;
  startDate: string; // yyyymmdd
  endDate: string; // yyyymmdd
  skipDays: number;
  stakeAmount: number;
  charityName: string | null; // null in pool mode
}

/**
 * Grants membership inside an in-flight transaction — used both by a direct
 * open-group join and by approving an invite-only request, so the write
 * shape (memberIds + members/{uid}) only exists in one place.
 */
function grantMembershipInTransaction(
  t: Transaction,
  challengeRef: DocumentReference,
  uid: string,
  member: { displayName: string; username: string | null; charityName: string | null }
): void {
  t.update(challengeRef, { memberIds: FieldValue.arrayUnion(uid) });
  t.set(challengeRef.collection("members").doc(uid), {
    displayName: member.displayName,
    username: member.username,
    joinedAt: FieldValue.serverTimestamp(),
    charityName: member.charityName,
    outcome: null,
    completedCount: 0,
    skipsUsed: 0,
  });
}

export async function createChallengeAdmin(
  uid: string,
  fallbackName: string,
  payload: CreateChallengePayload
): Promise<{ id: string; joinCode: string | null }> {
  const db = getAdminDb();

  const userSnap = await db.collection("users").doc(uid).get();
  const displayName =
    (userSnap.data()?.displayName as string | undefined) ?? fallbackName;
  const username = (userSnap.data()?.username as string | undefined) ?? null;

  const joinCode =
    payload.mode === "group" ? await generateUniqueJoinCode() : null;

  const challengeRef = db.collection("challenges").doc();
  const batch = db.batch();
  batch.set(challengeRef, {
    name: payload.name,
    description: payload.description || null,
    createdBy: uid,
    mode: payload.mode,
    forfeitType: payload.forfeitType,
    charityName: payload.charityName,
    joinCode,
    joinPolicy: payload.mode === "group" ? payload.joinPolicy : null,
    maxMembers: payload.maxMembers,
    frequency: {
      type: payload.frequencyType,
      target: payload.frequencyType === "daily" ? 1 : payload.target,
    },
    skipDays: payload.skipDays,
    stakeAmount: payload.stakeAmount,
    startDate: payload.startDate,
    endDate: payload.endDate,
    status: "active",
    memberIds: [uid],
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(challengeRef.collection("members").doc(uid), {
    displayName,
    username,
    joinedAt: FieldValue.serverTimestamp(),
    charityName: payload.charityName,
    outcome: null,
    completedCount: 0,
    skipsUsed: 0,
  });
  await batch.commit();

  return { id: challengeRef.id, joinCode };
}

export type JoinErrorCode =
  | "not-found"
  | "started"
  | "full"
  | "already-member"
  | "already-requested"
  | "not-group"
  | "charity-required";

export class JoinError extends Error {
  constructor(public code: JoinErrorCode) {
    super(code);
  }
}

export interface ChallengePreview {
  id: string;
  name: string;
  description: string | null;
  creatorName: string;
  forfeitType: "charity" | "pool";
  startDate: string;
  endDate: string;
  stakeAmount: number;
  skipDays: number;
  frequencyType: "daily" | "weekly_count";
  target: number;
  memberCount: number;
  maxMembers: number | null;
  started: boolean;
  joinPolicy: "open" | "invite";
  hasPendingRequest: boolean;
  isMember: (uid: string) => boolean;
}

/**
 * Non-sensitive preview for /join/[code]; null when no active challenge has
 * the code. `viewerUid`, if given, resolves `hasPendingRequest` for that
 * user on invite-only groups.
 */
export async function getChallengePreview(
  joinCode: string,
  viewerUid?: string
): Promise<ChallengePreview | null> {
  const db = getAdminDb();
  const snap = await db
    .collection("challenges")
    .where("joinCode", "==", joinCode.toUpperCase())
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (snap.empty) return null;

  const doc = snap.docs[0];
  const data = doc.data();
  if (data.mode !== "group") return null;

  const creatorSnap = await doc.ref.collection("members").doc(data.createdBy).get();
  const memberIds = (data.memberIds as string[]) ?? [];
  const joinPolicy = (data.joinPolicy as "open" | "invite" | undefined) ?? "open";

  let hasPendingRequest = false;
  if (viewerUid && joinPolicy === "invite") {
    const requestSnap = await doc.ref.collection("joinRequests").doc(viewerUid).get();
    hasPendingRequest = requestSnap.exists;
  }

  return {
    id: doc.id,
    name: data.name,
    description: data.description ?? null,
    creatorName: (creatorSnap.data()?.displayName as string | undefined) ?? "Someone",
    forfeitType: data.forfeitType ?? "charity",
    startDate: data.startDate,
    endDate: data.endDate,
    stakeAmount: data.stakeAmount,
    skipDays: data.skipDays,
    frequencyType: data.frequency?.type ?? "daily",
    target: data.frequency?.target ?? 1,
    memberCount: memberIds.length,
    maxMembers: data.maxMembers ?? null,
    started: yyyymmddUTC(new Date()) >= data.startDate,
    joinPolicy,
    hasPendingRequest,
    isMember: (uid: string) => memberIds.includes(uid),
  };
}

export type JoinResult =
  | { status: "joined"; challengeId: string }
  | { status: "pending" };

/**
 * On an "open" group, grants membership immediately. On an "invite" group,
 * creates a joinRequests/{uid} doc instead and returns "pending" — the
 * creator approves or rejects it later via respondToJoinRequestAdmin.
 */
export async function joinChallengeAdmin(
  uid: string,
  fallbackName: string,
  joinCode: string,
  charityName: string | null
): Promise<JoinResult> {
  const db = getAdminDb();

  const userSnap = await db.collection("users").doc(uid).get();
  const displayName =
    (userSnap.data()?.displayName as string | undefined) ?? fallbackName;
  const username = (userSnap.data()?.username as string | undefined) ?? null;

  const snap = await db
    .collection("challenges")
    .where("joinCode", "==", joinCode.toUpperCase())
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (snap.empty) throw new JoinError("not-found");
  const challengeRef = snap.docs[0].ref;

  return db.runTransaction<JoinResult>(async (t) => {
    const fresh = await t.get(challengeRef);
    const data = fresh.data();
    if (!data || data.status !== "active") throw new JoinError("not-found");
    if (data.mode !== "group") throw new JoinError("not-group");

    const memberIds = (data.memberIds as string[]) ?? [];
    if (memberIds.includes(uid)) throw new JoinError("already-member");
    if (yyyymmddUTC(new Date()) >= data.startDate) throw new JoinError("started");
    if (data.maxMembers != null && memberIds.length >= data.maxMembers) {
      throw new JoinError("full");
    }

    // Charity mode: each joiner must name their own charity. Pool mode
    // has no charity — the stake goes to the winners. Collected up front
    // even for a pending request, so it's ready the moment it's approved.
    const forfeitType = data.forfeitType ?? "charity";
    if (forfeitType === "charity" && !charityName?.trim()) {
      throw new JoinError("charity-required");
    }
    const memberCharityName = forfeitType === "charity" ? charityName!.trim() : null;

    const joinPolicy = (data.joinPolicy as "open" | "invite" | undefined) ?? "open";
    if (joinPolicy === "invite") {
      const requestRef = challengeRef.collection("joinRequests").doc(uid);
      const existingRequest = await t.get(requestRef);
      if (existingRequest.exists) throw new JoinError("already-requested");
      t.set(requestRef, {
        displayName,
        username,
        charityName: memberCharityName,
        requestedAt: FieldValue.serverTimestamp(),
      });
      return { status: "pending" };
    }

    grantMembershipInTransaction(t, challengeRef, uid, {
      displayName,
      username,
      charityName: memberCharityName,
    });
    return { status: "joined", challengeId: challengeRef.id };
  });
}

export type JoinRequestErrorCode = "not-owner" | "not-found" | "full" | "started";

export class JoinRequestError extends Error {
  constructor(public code: JoinRequestErrorCode) {
    super(code);
  }
}

/** Creator-only. Approving re-runs the same started/full checks a live join would. */
export async function respondToJoinRequestAdmin(
  callerUid: string,
  challengeId: string,
  targetUid: string,
  action: "approve" | "reject"
): Promise<void> {
  const db = getAdminDb();
  const challengeRef = db.collection("challenges").doc(challengeId);
  const requestRef = challengeRef.collection("joinRequests").doc(targetUid);

  await db.runTransaction(async (t) => {
    const [challengeSnap, requestSnap] = await Promise.all([
      t.get(challengeRef),
      t.get(requestRef),
    ]);
    const data = challengeSnap.data();
    if (!data) throw new JoinRequestError("not-found");
    if (data.createdBy !== callerUid) throw new JoinRequestError("not-owner");
    if (!requestSnap.exists) throw new JoinRequestError("not-found");

    if (action === "reject") {
      t.delete(requestRef);
      return;
    }

    const memberIds = (data.memberIds as string[]) ?? [];
    if (memberIds.includes(targetUid)) {
      // Already a member somehow — just clear the now-stale request.
      t.delete(requestRef);
      return;
    }
    if (yyyymmddUTC(new Date()) >= data.startDate) throw new JoinRequestError("started");
    if (data.maxMembers != null && memberIds.length >= data.maxMembers) {
      throw new JoinRequestError("full");
    }

    const request = requestSnap.data()!;
    grantMembershipInTransaction(t, challengeRef, targetUid, {
      displayName: request.displayName,
      username: request.username ?? null,
      charityName: request.charityName ?? null,
    });
    t.delete(requestRef);
  });
}

export type RemoveMemberErrorCode =
  | "not-found"
  | "not-owner"
  | "cannot-remove-creator"
  | "not-active"
  | "not-member";

export class RemoveMemberError extends Error {
  constructor(public code: RemoveMemberErrorCode) {
    super(code);
  }
}

/** Creator-only, any active group (upcoming or in-progress); can't remove yourself. */
export async function removeMemberAdmin(
  callerUid: string,
  challengeId: string,
  targetUid: string
): Promise<void> {
  const db = getAdminDb();
  const challengeRef = db.collection("challenges").doc(challengeId);
  const snap = await challengeRef.get();
  if (!snap.exists) throw new RemoveMemberError("not-found");

  const data = snap.data()!;
  if (data.createdBy !== callerUid) throw new RemoveMemberError("not-owner");
  if (targetUid === data.createdBy) throw new RemoveMemberError("cannot-remove-creator");
  if (data.status !== "active") throw new RemoveMemberError("not-active");

  const memberIds = (data.memberIds as string[]) ?? [];
  if (!memberIds.includes(targetUid)) throw new RemoveMemberError("not-member");

  const batch = db.batch();
  batch.update(challengeRef, { memberIds: FieldValue.arrayRemove(targetUid) });
  batch.delete(challengeRef.collection("members").doc(targetUid));
  await batch.commit();
}

export type DeleteChallengeErrorCode = "not-found" | "not-owner" | "not-solo";

export class DeleteChallengeError extends Error {
  constructor(public code: DeleteChallengeErrorCode) {
    super(code);
  }
}

/**
 * Solo only, creator only, any status — a solo challenge affects nobody but
 * its creator, so unlike group challenges there's no one else's record to
 * preserve. Ledger entries the challenge already produced are left alone
 * (same reasoning as account deletion: they're the debtor's standing
 * obligation, independent of whether the source challenge still exists).
 * recursiveDelete wipes the challenge doc plus its members/checkins
 * subcollections in one call.
 */
export async function deleteChallengeAdmin(
  uid: string,
  challengeId: string
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("challenges").doc(challengeId);
  const snap = await ref.get();
  if (!snap.exists) throw new DeleteChallengeError("not-found");

  const data = snap.data()!;
  if (data.createdBy !== uid) throw new DeleteChallengeError("not-owner");
  if (data.mode !== "solo") throw new DeleteChallengeError("not-solo");

  await db.recursiveDelete(ref);
}
