"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { myReflectionsQuery } from "@/lib/reflections";
import type {
  Challenge,
  ChallengeMember,
  JoinRequest,
  Reflection,
} from "@/lib/types";

export interface ChallengeDoc {
  /** undefined while loading, null if missing or unreadable. */
  challenge: Challenge | null | undefined;
  /** Every member's check-ins — the Members card grades all of them. */
  allCheckins: { uid: string; localDate: string }[];
  /**
   * Whether the check-ins have arrived. Distinct from `allCheckins.length`,
   * because a habit with no check-ins yet is not the same as one whose
   * check-ins haven't loaded — the progress bar animates on the difference.
   */
  checkinsLoaded: boolean;
  members: ({ uid: string } & ChallengeMember)[] | null;
  /** The viewer's own row out of `members`, or null while that is loading. */
  member: ChallengeMember | null;
  joinRequests: ({ uid: string } & JoinRequest)[] | null;
  /** The viewer's own reflections only; the read rule is uid-scoped. */
  reflections: Reflection[];
}

/**
 * Everything one habit page subscribes to, in one place.
 *
 * Five listeners, and they were previously interleaved with the rendering
 * logic they feed — a hundred lines of `onSnapshot` between the props and the
 * first thing that draws anything. Separating them isn't only tidiness: the
 * subscriptions have their own lifecycle rules (which ones depend on the
 * challenge document having loaded, which are creator-only) and those are
 * much easier to check when they sit together.
 *
 * Deliberately not folded into ActivityProvider. That holds the viewer's
 * whole habit list for the shell; this is one challenge including data about
 * *other* members, read only while their page is open.
 */
export function useChallengeDoc(id: string, uid: string): ChallengeDoc {
  const [challenge, setChallenge] = useState<Challenge | null | undefined>(undefined);
  const [allCheckins, setAllCheckins] = useState<
    { uid: string; localDate: string }[]
  >([]);
  const [checkinsLoaded, setCheckinsLoaded] = useState(false);
  const [members, setMembers] = useState<
    ({ uid: string } & ChallengeMember)[] | null
  >(null);
  const [joinRequests, setJoinRequests] = useState<
    ({ uid: string } & JoinRequest)[] | null
  >(null);
  const [reflections, setReflections] = useState<Reflection[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(getClientDb(), "challenges", id),
      (snap) => {
        setChallenge(
          snap.exists() ? ({ id: snap.id, ...snap.data() } as Challenge) : null
        );
      },
      () => setChallenge(null)
    );
    return unsubscribe;
  }, [id]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(getClientDb(), "challenges", id, "checkins"),
      (snap) => {
        setAllCheckins(
          snap.docs.map((d) => {
            const data = d.data();
            return { uid: data.uid as string, localDate: data.localDate as string };
          })
        );
        setCheckinsLoaded(true);
      }
    );
    return unsubscribe;
  }, [id]);

  // Own reflections only — the read rule is uid-scoped, so an unfiltered
  // listen here would be rejected outright rather than quietly returning less.
  useEffect(() => {
    const unsubscribe = onSnapshot(
      myReflectionsQuery(getClientDb(), id, uid),
      (snap) => setReflections(snap.docs.map((d) => d.data() as Reflection)),
      (err) => console.error("reflections query failed:", err)
    );
    return unsubscribe;
  }, [id, uid]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      // The whole members collection, which the Members card needs anyway —
      // and the viewer's own row is in it, so a second listener on
      // members/{uid} was a live subscription to a document already arriving
      // here.
      collection(getClientDb(), "challenges", id, "members"),
      (snap) =>
        setMembers(
          snap.docs.map(
            (d) => ({ uid: d.id, ...d.data() }) as { uid: string } & ChallengeMember
          )
        ),
      (err) => {
        console.error("members query failed:", err);
        setMembers(null);
      }
    );
    return unsubscribe;
  }, [id]);

  // Creator-only: the joinRequests read rule can only prove list-level
  // access for the creator (uniform across every doc in the collection) —
  // a regular member's own-request check has to be a single-doc read
  // instead, which happens server-side via getChallengePreview.
  useEffect(() => {
    if (challenge?.createdBy !== uid || challenge?.mode !== "group") {
      setJoinRequests(null);
      return;
    }
    const unsubscribe = onSnapshot(
      collection(getClientDb(), "challenges", id, "joinRequests"),
      (snap) =>
        setJoinRequests(
          snap.docs.map(
            (d) => ({ uid: d.id, ...d.data() }) as { uid: string } & JoinRequest
          )
        ),
      (err) => {
        console.error("join requests query failed:", err);
        setJoinRequests(null);
      }
    );
    return unsubscribe;
  }, [id, uid, challenge?.createdBy, challenge?.mode]);

  return {
    challenge,
    allCheckins,
    checkinsLoaded,
    members,
    member: members?.find((m) => m.uid === uid) ?? null,
    joinRequests,
    reflections,
  };
}
