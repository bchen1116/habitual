import "server-only";

import {
  FieldValue,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { addDaysYmd, daysBetweenInclusive, todayYmd } from "@/lib/dates";
import { repeatDurationDays } from "@/lib/duration";
import { badgesEarnedIn } from "@/lib/badges";
import { successorChainIds, type ForwardLink } from "@/lib/chain-core";
import type { Challenge } from "@/lib/types";

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
  visibility: "public" | "private";
  autoRepeat: boolean;
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
  member: {
    displayName: string;
    username: string | null;
    charityName: string | null;
    joinedDate: string;
  }
): void {
  t.update(challengeRef, { memberIds: FieldValue.arrayUnion(uid) });
  t.set(challengeRef.collection("members").doc(uid), {
    displayName: member.displayName,
    username: member.username,
    joinedAt: FieldValue.serverTimestamp(),
    joinedDate: member.joinedDate,
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
    joinClosed: payload.mode === "group" ? false : null,
    visibility: payload.visibility,
    maxMembers: payload.maxMembers,
    frequency: {
      type: payload.frequencyType,
      target: payload.frequencyType === "daily" ? 1 : payload.target,
    },
    skipDays: payload.skipDays,
    stakeAmount: payload.stakeAmount,
    startDate: payload.startDate,
    endDate: payload.endDate,
    autoRepeat: payload.autoRepeat,
    repeatedToId: null,
    weeksBefore: 0,
    status: "active",
    memberIds: [uid],
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(challengeRef.collection("members").doc(uid), {
    displayName,
    username,
    joinedAt: FieldValue.serverTimestamp(),
    // The creator's own requirement window always runs the challenge's full
    // length, never shortened — only later joiners get a later effective
    // start (see effectiveStart in lib/progress.ts).
    joinedDate: payload.startDate,
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
  | "closed"
  | "ended"
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
  /** Informational only — no longer gates joining, see joinClosed/ended below. */
  started: boolean;
  /** Past its endDate — a hard stop on joining regardless of joinClosed. */
  ended: boolean;
  /** Creator has explicitly closed joining — the only other thing that blocks it. */
  joinClosed: boolean;
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
    ended: yyyymmddUTC(new Date()) > data.endDate,
    joinClosed: data.joinClosed === true,
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
 *
 * Joining is allowed any time the challenge is running, not just before it
 * starts — the creator closes it explicitly (joinClosed) when they're ready
 * to stop taking new members, rather than it locking itself automatically
 * the moment the start date arrives. That used to be date-driven, which
 * broke the moment a challenge's start date fell on "today" in the
 * creator's timezone but was already "yesterday" in UTC (any timezone ahead
 * of UTC hits this on literally every challenge) — everyone saw "already
 * started" immediately, including for a challenge starting tomorrow.
 * Joining mid-challenge is still bounded by `endDate` below: there's no
 * useful reason to join something that's already fully over. A member who
 * joins after the challenge has started gets `joinedDate = today` instead
 * of the challenge's own startDate — effectiveStart() in lib/progress.ts
 * (and its mirror in functions/src/adjudicate.ts) uses that as their own
 * requirement window's floor, so joining late never counts days they
 * weren't a member yet as missed.
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
  // The joiner's own day, not UTC's. This decides two things that both move
  // money: whether the cycle is already over for them, and what their
  // joinedDate — their requirement floor — is. In UTC it got both wrong in
  // opposite directions: someone in Auckland could join a cycle that ended
  // yesterday where they live, and someone in Los Angeles was refused one
  // still running where they live. The first is the expensive one, because
  // a member joined past the last day is asked for nothing at all.
  const timezone = (userSnap.data()?.timezone as string | undefined) ?? "UTC";

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
    const today = todayYmd(timezone);
    if (data.joinClosed) throw new JoinError("closed");
    if (today > data.endDate) throw new JoinError("ended");
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
    // Whichever is later: joining before the challenge starts still means
    // the challenge's own startDate is their real floor.
    const joinedDate = today > data.startDate ? today : data.startDate;

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
      joinedDate,
    });
    return { status: "joined", challengeId: challengeRef.id };
  });
}

export type JoinRequestErrorCode = "not-owner" | "not-found" | "full" | "closed" | "ended";

export class JoinRequestError extends Error {
  constructor(public code: JoinRequestErrorCode) {
    super(code);
  }
}

/** Creator-only. Approving re-runs the same closed/ended/full checks a live join would. */
export async function respondToJoinRequestAdmin(
  callerUid: string,
  challengeId: string,
  targetUid: string,
  action: "approve" | "reject"
): Promise<void> {
  const db = getAdminDb();
  const challengeRef = db.collection("challenges").doc(challengeId);
  const requestRef = challengeRef.collection("joinRequests").doc(targetUid);

  // The person being approved, not the creator approving them and not UTC:
  // this decides their joinedDate, which is the floor on everything the cycle
  // then asks of them. Read outside the transaction because it isn't part of
  // the invariant being protected — the timezone of a user cannot change in a
  // way that matters between this read and the commit.
  const targetSnap = await db.collection("users").doc(targetUid).get();
  const timezone = (targetSnap.data()?.timezone as string | undefined) ?? "UTC";

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
    const today = todayYmd(timezone);
    if (data.joinClosed) throw new JoinRequestError("closed");
    if (today > data.endDate) throw new JoinRequestError("ended");
    if (data.maxMembers != null && memberIds.length >= data.maxMembers) {
      throw new JoinRequestError("full");
    }

    const request = requestSnap.data()!;
    grantMembershipInTransaction(t, challengeRef, targetUid, {
      displayName: request.displayName,
      username: request.username ?? null,
      charityName: request.charityName ?? null,
      // The date they're actually granted membership, not when they
      // requested — they couldn't check in during the gap while pending.
      joinedDate: today > data.startDate ? today : data.startDate,
    });
    t.delete(requestRef);
  });
}

export type SetJoinClosedErrorCode = "not-found" | "not-owner" | "not-group" | "not-active";

export class SetJoinClosedError extends Error {
  constructor(public code: SetJoinClosedErrorCode) {
    super(code);
  }
}

/**
 * Creator-only toggle, group challenges only. Unlike editChallengeAdmin,
 * this is meant to be used precisely when the group already has more than
 * its creator in it — closing signups once enough friends are in, whether
 * that's before or after the challenge has actually started.
 */
export async function setJoinClosedAdmin(
  uid: string,
  challengeId: string,
  closed: boolean
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("challenges").doc(challengeId);
  const snap = await ref.get();
  if (!snap.exists) throw new SetJoinClosedError("not-found");

  const data = snap.data()!;
  if (data.createdBy !== uid) throw new SetJoinClosedError("not-owner");
  if (data.mode !== "group") throw new SetJoinClosedError("not-group");
  if (data.status !== "active") throw new SetJoinClosedError("not-active");

  await ref.update({ joinClosed: closed });
}

export type SetVisibilityErrorCode = "not-found" | "not-owner" | "not-active";

export class SetVisibilityError extends Error {
  constructor(public code: SetVisibilityErrorCode) {
    super(code);
  }
}

/**
 * Creator-only leaderboard visibility toggle. Deliberately NOT routed through
 * editChallengeAdmin: that one refuses once anyone else has joined, because
 * it edits money terms people signed up under. Visibility isn't a money term
 * — and "my friends joined and now I'd rather this habit not be public" is
 * exactly when you need it — so this follows setJoinClosedAdmin's shape
 * instead and stays available for the whole active life of the habit.
 *
 * Applies to solo habits too: a private solo habit still counts toward the
 * streak *you* see for yourself (you're its only member) but not toward the
 * number anyone else sees.
 */
export async function setChallengeVisibilityAdmin(
  uid: string,
  challengeId: string,
  visibility: "public" | "private"
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("challenges").doc(challengeId);
  const snap = await ref.get();
  if (!snap.exists) throw new SetVisibilityError("not-found");

  const data = snap.data()!;
  if (data.createdBy !== uid) throw new SetVisibilityError("not-owner");
  if (data.status !== "active") throw new SetVisibilityError("not-active");

  await ref.update({ visibility });
}

export type SetAutoRepeatErrorCode = "not-found" | "not-owner" | "not-active";

export class SetAutoRepeatError extends Error {
  constructor(public code: SetAutoRepeatErrorCode) {
    super(code);
  }
}

/**
 * Creator-only "keep this habit going" switch, same shape as
 * setChallengeVisibilityAdmin above and available for the same reason: it
 * isn't a money term of the *current* cycle, so freezing it once other people
 * have joined would protect nothing. It only decides whether a successor gets
 * created, and turning it off before that happens cancels it outright.
 *
 * Restricted to active challenges. Once a cycle has ended there's nothing
 * useful left for the flag to do — the job that reads it has already passed
 * this habit by, and a successor starting today would leave a gap in the
 * chain that breaks the streak. The manual Repeat button covers that case,
 * which is exactly why it still exists.
 *
 * Turning it off does NOT delete a successor already created (repeatedToId
 * is left as-is): that cycle is a real challenge other people may already have
 * checked into, and silently deleting it would be a far bigger surprise than
 * one extra cycle. The UI says so.
 */
export async function setAutoRepeatAdmin(
  uid: string,
  challengeId: string,
  autoRepeat: boolean
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("challenges").doc(challengeId);
  const snap = await ref.get();
  if (!snap.exists) throw new SetAutoRepeatError("not-found");

  const data = snap.data()!;
  if (data.createdBy !== uid) throw new SetAutoRepeatError("not-owner");
  if (data.status !== "active") throw new SetAutoRepeatError("not-active");

  await ref.update({ autoRepeat });
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

/**
 * Creator-only, any active group (upcoming or in-progress); can't remove
 * yourself.
 *
 * **Removal runs forward, not just here.** "Remove" means the person is out of
 * the habit, not out of one week of it, so this also drops them from every
 * cycle further down the repeat chain that already exists. Usually there are
 * none — a successor is normally created from this cycle's membership after
 * the fact, so removing someone now simply means they're never copied across.
 * The exception is the one that matters: auto-repeat builds the next cycle a
 * full day *before* the current one ends (see functions/src/auto-repeat.ts),
 * so a creator removing someone on the final day is looking at a habit whose
 * next cycle already lists them. Without this walk they'd be gone from the
 * cycle that's ending and back in the one starting tomorrow — the two writes
 * a creator would least expect to come apart.
 *
 * Excusing deliberately does NOT work this way (setMemberExclusionAdmin):
 * a stake is settled per cycle and "not this week" is the whole point of it.
 * Removal is the permanent one, and so is the one that travels.
 */
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

  // Seeded with the cycle already read, so the common case (no successor yet)
  // costs no second read at all.
  const cache = new Map<string, ForwardLink | null>([
    [challengeId, data as ForwardLink],
  ]);
  const futureIds = await successorChainIds(async (id) => {
    if (!cache.has(id)) {
      const doc = await db.collection("challenges").doc(id).get();
      cache.set(id, doc.exists ? (doc.data() as ForwardLink) : null);
    }
    return cache.get(id)!;
  }, challengeId);

  // One batch over the whole chain: a partial removal would leave the member
  // in some future cycles and not others, with no way for anyone to tell
  // which. Two writes per cycle, and the walk is bounded (MAX_FORWARD_CYCLES)
  // so the batch cannot outgrow Firestore's 500-operation limit.
  const batch = db.batch();
  for (const id of [challengeId, ...futureIds]) {
    const ref = db.collection("challenges").doc(id);
    batch.update(ref, { memberIds: FieldValue.arrayRemove(targetUid) });
    batch.delete(ref.collection("members").doc(targetUid));
  }
  await batch.commit();
}

export type ExcludeMemberErrorCode =
  | "not-found"
  | "not-owner"
  | "not-member"
  | "not-active"
  | "cannot-exclude-self";

export class ExcludeMemberError extends Error {
  constructor(public code: ExcludeMemberErrorCode) {
    super(code);
  }
}

/**
 * Creator-only: excuse a member from this cycle, or put them back.
 *
 * The member is asked for nothing for the rest of the cycle and takes no part
 * in the stake — they neither forfeit nor share a pool. Mechanically it
 * resolves to the same cycle-wide step-out that booking too much time off
 * produces (see excludedFromCycle), so nothing downstream needs to learn a
 * new state.
 *
 * **Per cycle, deliberately.** A stake is resolved per cycle, so "out of the
 * pool and the stakes" has no smaller unit to attach to; and the member doc
 * this writes to is itself per cycle, so excusing someone from this week
 * cannot leak into next week. Neither repeatChallengeAdmin nor the
 * auto-repeat job copies the flag forward — they build the successor's member
 * docs field by field, and this field is not among them.
 *
 * **Not the creator themselves.** Removing your own stake while leaving
 * everyone else's in play is not an excusal, it's a withdrawal, and a pool
 * whose organiser can step out of it after seeing how it's going is not a
 * pool. Mirrors the same rule on removeMemberAdmin.
 *
 * **Only while the cycle is live.** Once graded the result is settled and the
 * ledger has been written; changing the input afterwards would make a settled
 * record a lie.
 *
 * Reversible for as long as the cycle is: setting it back puts them and their
 * stake straight back in. `excludedBy`/`excludedAt` are recorded because this
 * moves money on someone else's behalf and should be answerable later.
 */
export async function setMemberExclusionAdmin(
  callerUid: string,
  challengeId: string,
  targetUid: string,
  excluded: boolean
): Promise<void> {
  const db = getAdminDb();
  const challengeRef = db.collection("challenges").doc(challengeId);
  const snap = await challengeRef.get();
  if (!snap.exists) throw new ExcludeMemberError("not-found");

  const data = snap.data()!;
  if (data.createdBy !== callerUid) throw new ExcludeMemberError("not-owner");
  if (targetUid === data.createdBy) {
    throw new ExcludeMemberError("cannot-exclude-self");
  }
  if (data.status !== "active") throw new ExcludeMemberError("not-active");
  if (!((data.memberIds as string[]) ?? []).includes(targetUid)) {
    throw new ExcludeMemberError("not-member");
  }

  const memberRef = challengeRef.collection("members").doc(targetUid);
  if (!(await memberRef.get()).exists) {
    throw new ExcludeMemberError("not-member");
  }

  await memberRef.update(
    excluded
      ? {
          excluded: true,
          excludedBy: callerUid,
          excludedAt: FieldValue.serverTimestamp(),
        }
      : {
          excluded: false,
          excludedBy: FieldValue.delete(),
          excludedAt: FieldValue.delete(),
        }
  );
}

export interface EditChallengePayload {
  stakeAmount: number;
  endDate: string; // yyyymmdd
  skipDays: number;
}

export type EditChallengeErrorCode =
  | "not-found"
  | "not-owner"
  | "ended"
  | "already-joined"
  | "invalid-duration"
  | "invalid-stake"
  | "has-next-cycle";

export class EditChallengeError extends Error {
  constructor(public code: EditChallengeErrorCode) {
    super(code);
  }
}

/**
 * Creator-only, matching the same "terms are frozen once anyone else has
 * joined" rule the app already applies to direct term edits
 * (firestore.rules' challenges/{cid} update block) — a group challenge is
 * only editable while the creator is still its sole member; a solo
 * challenge has no one else to protect, so it's editable any time it's
 * still active (upcoming or in-progress, not yet ended).
 *
 * Increasing skipDays stamps `streakResetAt = today`, which streakRun()
 * (src/lib/streak.ts) treats as a floor — checkins before the edit stop
 * counting toward the live streak, i.e. "starting a new habit," per the
 * product decision this exists for. Decreasing or leaving skipDays alone
 * never touches it.
 */
export async function editChallengeAdmin(
  uid: string,
  challengeId: string,
  payload: EditChallengePayload
): Promise<{ streakEnded: boolean }> {
  const db = getAdminDb();
  const ref = db.collection("challenges").doc(challengeId);

  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const data = snap.data();
    if (!data) throw new EditChallengeError("not-found");
    if (data.createdBy !== uid) throw new EditChallengeError("not-owner");

    const today = yyyymmddUTC(new Date());
    if (data.status !== "active" || today > data.endDate) {
      throw new EditChallengeError("ended");
    }

    const memberIds = (data.memberIds as string[]) ?? [];
    if (data.mode === "group" && memberIds.length > 1) {
      throw new EditChallengeError("already-joined");
    }

    // The next cycle is already written, and it was built from this one's end
    // date: its start is endDate + 1, and its week numbering counts the weeks
    // this one contains. Moving the end date now would overlap the two or
    // leave a gap between them — either way the streak stops carrying across
    // the seam (walkChainWith requires them to be back-to-back) and the
    // successor's week numbers would be off by however much the date moved.
    if (data.repeatedToId && payload.endDate !== data.endDate) {
      throw new EditChallengeError("has-next-cycle");
    }

    const days = daysBetweenInclusive(data.startDate, payload.endDate);
    if (days % 7 !== 0 || days < 7 || days > 364 || payload.endDate < today) {
      throw new EditChallengeError("invalid-duration");
    }
    if (payload.stakeAmount <= 0 || payload.stakeAmount > 10000) {
      throw new EditChallengeError("invalid-stake");
    }

    const streakEnded = payload.skipDays > ((data.skipDays as number) ?? 0);
    t.update(ref, {
      stakeAmount: payload.stakeAmount,
      endDate: payload.endDate,
      skipDays: payload.skipDays,
      ...(streakEnded ? { streakResetAt: today } : {}),
    });
    return { streakEnded };
  });
}

export type DeleteChallengeErrorCode = "not-found" | "not-owner" | "already-joined";

export class DeleteChallengeError extends Error {
  constructor(public code: DeleteChallengeErrorCode) {
    super(code);
  }
}

/**
 * Creator-only, any status. Solo challenges affect nobody but their
 * creator, so there's no one else's record to preserve. A group challenge
 * is deletable on the same terms it's editable on (editChallengeAdmin) —
 * only while the creator is still its sole member; once anyone else has
 * joined, "Cancel" (which keeps a record other members can see) is the
 * only way out, matching the app's existing "members joined under
 * specific terms" philosophy (firestore.rules' challenges/{cid} update
 * block). Ledger entries the challenge already produced are left alone
 * (same reasoning as account deletion: they're the debtor's standing
 * obligation, independent of whether the source challenge still exists).
 * The "already-joined" guard is re-checked inside a transaction
 * immediately before deleting the challenge doc, not just from a plain
 * get() beforehand — otherwise a join committing in the window between an
 * earlier read and an unconditional delete could have its brand-new
 * member doc silently wiped out with no notification. recursiveDelete
 * itself can't run inside a transaction (it's a batch/admin-only
 * primitive, not a transactional write), so the transaction deletes just
 * the challenge doc under the same guard; subcollection cleanup happens
 * right after — once the parent doc is gone (and with it, read access —
 * firestore.rules gates every subcollection read on the parent's
 * memberIds), any straggler subcollection doc is inert cleanup, not a
 * correctness concern.
 */
export async function deleteChallengeAdmin(
  uid: string,
  challengeId: string
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection("challenges").doc(challengeId);

  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new DeleteChallengeError("not-found");

    const data = snap.data()!;
    if (data.createdBy !== uid) throw new DeleteChallengeError("not-owner");

    const memberIds = (data.memberIds as string[]) ?? [];
    if (data.mode === "group" && memberIds.length > 1) {
      throw new DeleteChallengeError("already-joined");
    }

    t.delete(ref);
  });

  await Promise.all([
    db.recursiveDelete(ref.collection("members")),
    db.recursiveDelete(ref.collection("checkins")),
    db.recursiveDelete(ref.collection("joinRequests")),
    db.recursiveDelete(ref.collection("reflections")),
  ]);
}

export interface RepeatChallengePayload {
  stakeAmount: number;
  skipDays: number;
}

export type RepeatChallengeErrorCode =
  | "not-found"
  | "not-owner"
  | "not-ended"
  | "invalid-stake";

export class RepeatChallengeError extends Error {
  constructor(public code: RepeatChallengeErrorCode) {
    super(code);
  }
}

/**
 * Creator-only. Starts a new cycle of an ended habit — same name,
 * description, mode, forfeitType, joinPolicy, maxMembers, and frequency;
 * `repeatedFromId` links the new cycle back to this one, so a chain-aware
 * streak (src/lib/chain-streak.ts) can walk backward through it later;
 * stake/end-date/skip-days can be adjusted, same fields editChallengeAdmin
 * already lets a creator tweak. The new cycle's start date is always
 * max(today, dayAfterOldEndDate) — never user-chosen — so repeated cycles
 * chain without gaps or overlaps.
 *
 * For group habits, every prior member (from the old challenge's members
 * subcollection, including the creator) carries into the new cycle
 * automatically, reusing their stored displayName/username/charityName
 * as-is — a deliberate product choice: repeating re-commits every member's
 * stake without their own fresh action, the same way it re-commits the
 * creator's. No "already repeated" link is tracked, so repeating twice
 * just produces two new cycles.
 *
 * Unlike editChallengeAdmin this only reads an already-ended (immutable)
 * challenge before writing a new one, so there's no concurrent-mutation
 * race to protect against with a transaction — a plain read + batch write
 * is enough.
 */
export async function repeatChallengeAdmin(
  uid: string,
  challengeId: string,
  payload: RepeatChallengePayload
): Promise<{ id: string; joinCode: string | null }> {
  const db = getAdminDb();
  const oldRef = db.collection("challenges").doc(challengeId);
  const snap = await oldRef.get();
  if (!snap.exists) throw new RepeatChallengeError("not-found");

  const data = snap.data()!;
  if (data.createdBy !== uid) throw new RepeatChallengeError("not-owner");

  // The creator's own day, not UTC's, so a cycle finished on Sunday evening
  // in New York doesn't start its successor on Tuesday.
  const creatorSnap = await db.collection("users").doc(uid).get();
  const timezone = (creatorSnap.data()?.timezone as string | undefined) ?? "UTC";
  const today = todayYmd(timezone);

  const ended = data.status === "adjudicated" || today > data.endDate;
  if (!ended) throw new RepeatChallengeError("not-ended");

  const dayAfter = addDaysYmd(data.endDate, 1);
  const newStartDate = today > dayAfter ? today : dayAfter;

  // The next cycle runs exactly as long as the last one: a weekly habit
  // repeats as another week, a four-week ("monthly") one as another four
  // weeks. Both dates are derived here rather than sent up, which is what
  // fixes the bug this replaced — the client computed the next start from the
  // user's *local* date and the server re-derived it in UTC, so whenever the
  // two disagreed (most of the day, for most of the world) the end date the
  // client had calculated was a day out and the server rejected the whole
  // thing as "not a whole number of weeks". Repeat simply never worked
  // outside a narrow UTC window. With nothing to disagree about, it can't.
  const days = repeatDurationDays(daysBetweenInclusive(data.startDate, data.endDate));
  const newEndDate = addDaysYmd(newStartDate, days - 1);
  if (payload.stakeAmount <= 0 || payload.stakeAmount > 10000) {
    throw new RepeatChallengeError("invalid-stake");
  }

  const joinCode = data.mode === "group" ? await generateUniqueJoinCode() : null;

  // The old cycle's check-ins, so the badges it earned come across with it.
  // Copying the stored `badgesCarried` alone silently loses them: that field
  // is only ever written by adjudication, which doesn't run until 39 hours
  // past the end date — and Repeat is normally pressed the moment the habit
  // ends, well before that. A 4-week habit with perfect attendance would
  // hand over 0 of the 4 skips it had just earned.
  const [memberDocs, checkinDocs, spareDocs] = await Promise.all([
    oldRef.collection("members").get(),
    oldRef.collection("checkins").get(),
    oldRef.collection("spares").get(),
  ]);
  const oldCheckinsByUid = new Map<string, string[]>();
  for (const doc of checkinDocs.docs) {
    const { uid: memberUid, localDate } = doc.data() as {
      uid: string;
      localDate: string;
    };
    const list = oldCheckinsByUid.get(memberUid) ?? [];
    list.push(localDate);
    oldCheckinsByUid.set(memberUid, list);
  }
  // Spares committed to the cycle being repeated. Only the unspent balance
  // moves forward, which is the whole point of applying one deliberately —
  // and it's why this can't just copy `badgesCarried`, on either side of
  // adjudication.
  const oldSparesByUid = new Map<string, number>();
  for (const doc of spareDocs.docs) {
    const { uid: memberUid, count } = doc.data() as {
      uid: string;
      count: number;
    };
    oldSparesByUid.set(
      memberUid,
      (oldSparesByUid.get(memberUid) ?? 0) + Math.max(0, count)
    );
  }
  const oldChallenge = { id: challengeId, ...data } as Challenge;
  // Once adjudication has run, the member doc's badgesCarried IS the settled
  // running total — it already includes this cycle's earnings. Recounting
  // them on top would hand out every badge twice to anyone who repeated a
  // habit a day or two later than usual.
  const settled = data.status === "adjudicated";

  const newRef = db.collection("challenges").doc();
  const batch = db.batch();
  batch.set(newRef, {
    name: data.name,
    description: data.description ?? null,
    createdBy: uid,
    mode: data.mode,
    forfeitType: data.forfeitType,
    charityName: data.charityName,
    joinCode,
    joinPolicy: data.joinPolicy ?? null,
    joinClosed: data.mode === "group" ? false : null,
    // Carried forward: a habit kept off the leaderboard stays off it when
    // its next cycle starts, without the creator having to re-set that.
    visibility: data.visibility ?? "public",
    maxMembers: data.maxMembers ?? null,
    frequency: data.frequency,
    skipDays: payload.skipDays,
    stakeAmount: payload.stakeAmount,
    startDate: newStartDate,
    endDate: newEndDate,
    // Carried forward like visibility: a habit set to keep going keeps going,
    // whether this particular cycle was started by the button or by the job.
    autoRepeat: (data.autoRepeat as boolean | undefined) ?? false,
    repeatedToId: null,
    // Week numbering carries on rather than restarting: repeating a 1-week
    // habit gives you week 2, not week 1 again.
    weeksBefore:
      ((data.weeksBefore as number | undefined) ?? 0) +
      Math.floor(daysBetweenInclusive(data.startDate, data.endDate) / 7),
    status: "active",
    memberIds: memberDocs.docs.map((d) => d.id),
    repeatedFromId: challengeId,
    createdAt: FieldValue.serverTimestamp(),
  });
  for (const memberDoc of memberDocs.docs) {
    const member = memberDoc.data();
    batch.set(newRef.collection("members").doc(memberDoc.id), {
      displayName: member.displayName,
      username: member.username ?? null,
      joinedAt: FieldValue.serverTimestamp(),
      // Everyone carried over starts the new cycle together, regardless of
      // when they joined the previous one.
      joinedDate: newStartDate,
      // Spares follow the habit, not the cycle: "a badge in one habit cannot
      // be applied to another habit". Everything banked before this cycle,
      // plus everything this cycle earned — counted here from its check-ins
      // rather than read from a field adjudication hasn't written yet — less
      // everything it spent. That keeps the adjudicator from ever having to
      // walk the repeat chain: one balance moves forward one link at a time.
      //
      // The applied spares are subtracted on both sides of `settled`. Before
      // grading they're the pessimistic reading (adjudication hands back any
      // the final misses didn't need); after it, `badgesCarried` is already
      // net of what was actually spent, so subtracting again here would
      // charge for them twice — which is why the deduction, unlike the
      // earnings, is inside the settled branch too.
      badgesCarried: Math.max(
        0,
        settled
          ? ((member.badgesCarried as number | undefined) ?? 0)
          : ((member.badgesCarried as number | undefined) ?? 0) +
            badgesEarnedIn(
              oldChallenge,
              oldCheckinsByUid.get(memberDoc.id) ?? [],
              today,
              member.joinedDate as string | undefined
            ) -
            (oldSparesByUid.get(memberDoc.id) ?? 0)
      ),
      charityName: member.charityName ?? null,
      outcome: null,
      completedCount: 0,
      skipsUsed: 0,
    });
  }
  // The forward link, which does two jobs. Adjudication follows it to correct
  // the successor's badge total once the final week is graded, and
  // autoRepeatEndingChallenges treats it as "a successor already exists" — so
  // repeating by hand can't be followed by the job quietly adding a second
  // cycle on top. Only set when absent: if auto-repeat got here first, its
  // successor keeps the correction, and this one already carries an accurate
  // count from the check-ins above.
  if (!data.repeatedToId) {
    batch.update(oldRef, { repeatedToId: newRef.id });
  }

  await batch.commit();

  return { id: newRef.id, joinCode };
}
