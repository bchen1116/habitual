import "server-only";

import { FieldValue } from "firebase-admin/firestore";
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
  maxMembers: number | null;
  frequencyType: "daily" | "weekly_count";
  target: number;
  startDate: string; // yyyymmdd
  endDate: string; // yyyymmdd
  skipDays: number;
  stakeAmount: number;
  charityName: string;
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

  const joinCode =
    payload.mode === "group" ? await generateUniqueJoinCode() : null;

  const challengeRef = db.collection("challenges").doc();
  const batch = db.batch();
  batch.set(challengeRef, {
    name: payload.name,
    description: payload.description || null,
    createdBy: uid,
    mode: payload.mode,
    forfeitType: "charity",
    charityName: payload.charityName,
    joinCode,
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
  | "not-group";

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
  startDate: string;
  endDate: string;
  stakeAmount: number;
  skipDays: number;
  frequencyType: "daily" | "weekly_count";
  target: number;
  memberCount: number;
  maxMembers: number | null;
  started: boolean;
  isMember: (uid: string) => boolean;
}

/** Non-sensitive preview for /join/[code]; null when no active challenge has the code. */
export async function getChallengePreview(
  joinCode: string
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

  return {
    id: doc.id,
    name: data.name,
    description: data.description ?? null,
    creatorName: (creatorSnap.data()?.displayName as string | undefined) ?? "Someone",
    startDate: data.startDate,
    endDate: data.endDate,
    stakeAmount: data.stakeAmount,
    skipDays: data.skipDays,
    frequencyType: data.frequency?.type ?? "daily",
    target: data.frequency?.target ?? 1,
    memberCount: memberIds.length,
    maxMembers: data.maxMembers ?? null,
    started: yyyymmddUTC(new Date()) >= data.startDate,
    isMember: (uid: string) => memberIds.includes(uid),
  };
}

export async function joinChallengeAdmin(
  uid: string,
  fallbackName: string,
  joinCode: string,
  charityName: string
): Promise<{ challengeId: string }> {
  const db = getAdminDb();

  const userSnap = await db.collection("users").doc(uid).get();
  const displayName =
    (userSnap.data()?.displayName as string | undefined) ?? fallbackName;

  const snap = await db
    .collection("challenges")
    .where("joinCode", "==", joinCode.toUpperCase())
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (snap.empty) throw new JoinError("not-found");
  const challengeRef = snap.docs[0].ref;

  await db.runTransaction(async (t) => {
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

    t.update(challengeRef, { memberIds: FieldValue.arrayUnion(uid) });
    t.set(challengeRef.collection("members").doc(uid), {
      displayName,
      joinedAt: FieldValue.serverTimestamp(),
      charityName,
      outcome: null,
      completedCount: 0,
      skipsUsed: 0,
    });
  });

  return { challengeId: challengeRef.id };
}
