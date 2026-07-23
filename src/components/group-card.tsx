"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { todayYmd } from "@/lib/dates";
import type { Challenge, ChallengeMember } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

const MAX_VISIBLE_AVATARS = 4;

export function GroupCard({
  challenge,
  timezone,
}: {
  challenge: Challenge;
  timezone: string;
}) {
  const [members, setMembers] = useState<
    ({ uid: string } & ChallengeMember)[] | null
  >(null);
  const [checkins, setCheckins] = useState<{ uid: string; localDate: string }[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(getClientDb(), "challenges", challenge.id, "members"),
      (snap) =>
        setMembers(
          snap.docs.map(
            (d) => ({ uid: d.id, ...d.data() }) as { uid: string } & ChallengeMember
          )
        )
    );
    return unsubscribe;
  }, [challenge.id]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(getClientDb(), "challenges", challenge.id, "checkins"),
      (snap) =>
        setCheckins(
          snap.docs.map((d) => {
            const data = d.data();
            return { uid: data.uid as string, localDate: data.localDate as string };
          })
        )
    );
    return unsubscribe;
  }, [challenge.id]);

  const today = todayYmd(timezone);
  const total = members?.length ?? 0;
  const checkedInTodayCount = (members ?? []).filter((m) =>
    checkins.some((c) => c.uid === m.uid && c.localDate === today)
  ).length;

  const visible = (members ?? []).slice(0, MAX_VISIBLE_AVATARS);
  const overflow = total - visible.length;

  return (
    <Link
      href={`/challenges/${challenge.id}`}
      className="flex flex-col gap-3 rounded-[20px] bg-card p-5 transition-opacity hover:opacity-90"
    >
      <div className="flex items-center justify-between">
        <h3 className="type-display text-xl">{challenge.name}</h3>
        <Badge variant="outline">Group</Badge>
      </div>
      <div className="flex -space-x-2.5">
        {visible.map((m) => (
          <Avatar key={m.uid} name={m.displayName} size="sm" ring="card" />
        ))}
        {overflow > 0 && (
          <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-card bg-ink text-sm font-bold text-primary">
            +{overflow}
          </span>
        )}
      </div>
      {total > 0 && (
        <p className="text-sm text-muted-foreground">
          {checkedInTodayCount} of {total} checked in today
        </p>
      )}
    </Link>
  );
}
