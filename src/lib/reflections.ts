"use client";

import {
  collection,
  collectionGroup,
  doc,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
  type DocumentReference,
  type Query,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import type { MissReason, Reflection } from "@/lib/types";

/**
 * Private per-day reflections: a 1–10 rating of how a session went, and a
 * reason for a day that was missed. See the `Reflection` docblock in
 * lib/types.ts for why this lives beside the check-in rather than inside it.
 */

export const MIN_RATING = 1;
export const MAX_RATING = 10;

/** Ordered as they're offered in the picker; keys are what's persisted. */
export const MISS_REASONS: { key: MissReason; label: string }[] = [
  { key: "no_time", label: "No time" },
  { key: "too_ambitious", label: "Too ambitious" },
  { key: "wrong_time", label: "Wrong time of day" },
  { key: "travel", label: "Travel" },
  { key: "unwell", label: "Unwell" },
  { key: "forgot", label: "Forgot" },
  { key: "lost_motivation", label: "Lost motivation" },
  { key: "other", label: "Something else" },
];

const MISS_REASON_LABELS = new Map(MISS_REASONS.map((r) => [r.key, r.label]));

export function missReasonLabel(reason: MissReason): string {
  return MISS_REASON_LABELS.get(reason) ?? "Something else";
}

/** Same `<localDate>_<uid>` shape as a check-in doc, and enforced by rules. */
function reflectionId(localDate: string, uid: string): string {
  return `${localDate}_${uid}`;
}

/**
 * Every reflection this user has ever written, in one query, whichever habit
 * it belongs to. The per-habit version below is one query per habit — for
 * someone with five running habits and twenty finished ones that is twenty-five
 * round trips from a phone to render a single page.
 *
 * Needs the collection-group read rule and collection-group indexing on `uid`,
 * both of which deploy separately from the app. Callers must therefore be able
 * to fall back (see use-reflection-history) rather than assume it works — the
 * app can ship before the index does.
 *
 * That index is a `fieldOverrides` entry in firestore.indexes.json, not an
 * `indexes` one. A single-field composite is rejected outright — "this index
 * is not necessary, configure using single field index controls" — because
 * one equality filter never needs a composite. What a collection-group query
 * actually needs is the *existing* single-field index widened to
 * COLLECTION_GROUP scope, which is what a field override does. Declaring a
 * field override replaces every default index on that field, so the three
 * COLLECTION-scoped defaults are listed alongside it rather than silently
 * dropped.
 */
export function allMyReflectionsQuery(db: Firestore, uid: string): Query {
  return query(collectionGroup(db, "reflections"), where("uid", "==", uid));
}

/** The challenge a reflection belongs to, from its document path. */
export function reflectionChallengeId(ref: DocumentReference): string | null {
  return ref.parent.parent?.id ?? null;
}

/**
 * The caller's own reflections for a challenge. The `uid` filter isn't
 * cosmetic — the read rule is `resource.data.uid == request.auth.uid`, and a
 * list query only succeeds if every document it could return satisfies that,
 * so an unfiltered listen would be rejected outright.
 */
export function myReflectionsQuery(
  db: Firestore,
  challengeId: string,
  uid: string
): Query {
  return query(
    collection(db, "challenges", challengeId, "reflections"),
    where("uid", "==", uid)
  );
}

export const MAX_MISS_NOTE_LENGTH = 300;

/**
 * How the session went, on the day it happened. Merged rather than written
 * whole so it can't clobber a miss reason recorded for the same date in an
 * earlier cycle of a repeated habit.
 */
export function saveRating(
  challengeId: string,
  uid: string,
  localDate: string,
  rating: number | null
): Promise<void> {
  return writeReflection(challengeId, uid, localDate, { rating });
}

/** What got in the way. `reason: null` clears a previously recorded one. */
export function saveMissReason(
  challengeId: string,
  uid: string,
  localDate: string,
  reason: MissReason | null,
  note: string
): Promise<void> {
  return writeReflection(challengeId, uid, localDate, {
    missReason: reason,
    // A note with no reason attached is still worth keeping, but clearing the
    // reason clears the whole entry — that's what "remove" means to the user.
    missNote: reason === null ? null : note.trim().slice(0, MAX_MISS_NOTE_LENGTH) || null,
  });
}

function writeReflection(
  challengeId: string,
  uid: string,
  localDate: string,
  fields: Partial<Reflection>
): Promise<void> {
  const db = getClientDb();
  const ref = doc(
    db,
    "challenges",
    challengeId,
    "reflections",
    reflectionId(localDate, uid)
  );
  // uid and localDate go on every write, not just the first: the read rule and
  // the doc-ID check both depend on them, and a merge that omitted them on a
  // doc that didn't exist yet would create one the owner then couldn't read.
  return setDoc(ref, { uid, localDate, ...fields, updatedAt: serverTimestamp() }, {
    merge: true,
  });
}
