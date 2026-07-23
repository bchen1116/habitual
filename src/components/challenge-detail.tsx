"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { cancelChallenge } from "@/lib/challenges";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import {
  challengeState,
  dailyHistory,
  progressSummary,
  skipsUsed,
  totalRequired,
  weeklyWindows,
} from "@/lib/progress";
import Link from "next/link";
import { daysBetweenInclusive, formatYmd, todayYmd } from "@/lib/dates";
import { formatAmount } from "@/lib/ledger";
import type { Challenge, ChallengeMember } from "@/lib/types";
import { CheckinDialog } from "@/components/checkin-dialog";
import { ShareLink } from "@/components/share-link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ChallengeDetail({ id, uid }: { id: string; uid: string }) {
  const router = useRouter();
  const timezone = useUserTimezone(uid);
  const [challenge, setChallenge] = useState<Challenge | null | undefined>(undefined);
  const [allCheckins, setAllCheckins] = useState<
    { uid: string; localDate: string }[]
  >([]);
  const [member, setMember] = useState<ChallengeMember | null>(null);
  const [members, setMembers] = useState<
    ({ uid: string } & ChallengeMember)[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

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
      }
    );
    return unsubscribe;
  }, [id]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(getClientDb(), "challenges", id, "members", uid),
      (snap) => setMember(snap.exists() ? (snap.data() as ChallengeMember) : null),
      () => setMember(null)
    );
    return unsubscribe;
  }, [id, uid]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
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

  const checkinYmds = allCheckins
    .filter((c) => c.uid === uid)
    .map((c) => c.localDate);

  if (challenge === undefined) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }
  if (challenge === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Challenge not found</CardTitle>
          <CardDescription>
            It may have been removed, or you may not have access.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const today = todayYmd(timezone);
  const state = challengeState(challenge, today);
  const summary = progressSummary(challenge, checkinYmds, timezone);
  const isCreator = challenge.createdBy === uid;
  const canCancel = isCreator && state === "upcoming";

  async function handleCancel() {
    if (!window.confirm("Cancel this challenge? This can't be undone.")) return;
    setCancelling(true);
    try {
      await cancelChallenge(id);
      router.replace("/dashboard");
    } catch {
      setError("Couldn't cancel the challenge. Please try again.");
      setCancelling(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">{challenge.name}</h2>
          {challenge.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {challenge.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {challenge.mode === "group" && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
              {challenge.forfeitType === "pool" ? "Winner pool" : "Group"}
            </span>
          )}
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
            {state === "upcoming" && "Not started"}
            {state === "active" && "Active"}
            {state === "ended" && "Ended"}
            {state === "cancelled" && "Cancelled"}
            {state === "adjudicated" && "Complete"}
          </span>
        </div>
      </div>

      {challenge.mode === "group" && state === "upcoming" && challenge.joinCode && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Invite friends</CardTitle>
            <CardDescription>
              Share this link before the challenge starts — joining closes on{" "}
              {formatYmd(challenge.startDate)}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <code className="rounded-md bg-secondary px-3 py-1.5 font-mono text-sm tracking-widest">
              {challenge.joinCode}
            </code>
            <ShareLink joinCode={challenge.joinCode} name={challenge.name} />
          </CardContent>
        </Card>
      )}

      {state === "adjudicated" && member?.outcome === "succeeded" && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>You did it! 🎉</CardTitle>
            <CardDescription>
              {member.completedCount} check-ins, {member.skipsUsed} of{" "}
              {challenge.skipDays} skips used.{" "}
              {challenge.forfeitType === "pool"
                ? "Your stake stays yours — and any forfeited stakes appear in your ledger."
                : `Your ${formatAmount(challenge.stakeAmount)} stays yours.`}
            </CardDescription>
          </CardHeader>
          {challenge.forfeitType === "pool" && (
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/ledger?tab=owed">View in ledger</Link>
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {state === "adjudicated" && member?.outcome === "failed" && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>You missed too many days</CardTitle>
            <CardDescription>
              {challenge.forfeitType === "pool"
                ? `You owe ${formatAmount(challenge.stakeAmount)}, split among the members who succeeded. (If nobody succeeded, no one owes anything.)`
                : `You owe ${formatAmount(challenge.stakeAmount)} to ${member.charityName ?? "your charity"}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/ledger">View in ledger</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {state === "cancelled" && (
        <Card>
          <CardHeader>
            <CardTitle>Cancelled</CardTitle>
            <CardDescription>
              This challenge was cancelled before it started. No stakes apply.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {state === "upcoming" && (
        <Card>
          <CardHeader>
            <CardTitle>
              Starts in {daysBetweenInclusive(today, challenge.startDate) - 1} day
              {daysBetweenInclusive(today, challenge.startDate) - 1 === 1 ? "" : "s"}
            </CardTitle>
            <CardDescription>
              {formatYmd(challenge.startDate)} – {formatYmd(challenge.endDate)}
            </CardDescription>
          </CardHeader>
          {canCancel && (
            <CardContent>
              <Button
                variant="destructive"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling…" : "Cancel challenge"}
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {(state === "active" || state === "ended" || state === "adjudicated") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>
              {summary.completed} of {summary.total} check-ins
            </CardTitle>
            <CardDescription>
              {state === "active" &&
                `${summary.daysRemaining} day${summary.daysRemaining === 1 ? "" : "s"} remaining · ${summary.skipsUsed} of ${challenge.skipDays} skips used`}
              {state === "ended" && "Ended — results land in the next day or two"}
              {state === "adjudicated" &&
                `${formatYmd(challenge.startDate)} – ${formatYmd(challenge.endDate)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${summary.total > 0 ? Math.min(100, (summary.completed / summary.total) * 100) : 0}%`,
                }}
              />
            </div>
            {summary.canCheckInToday && (
              <div>
                <CheckinDialog
                  challenge={challenge}
                  uid={uid}
                  today={today}
                  onError={setError}
                />
              </div>
            )}
            {summary.checkedInToday && (
              <p className="text-sm text-muted-foreground">Checked in today ✓</p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}

      {challenge.mode === "group" && members && members.length > 0 && (
        <MembersCard
          challenge={challenge}
          members={members}
          allCheckins={allCheckins}
          today={today}
          selfUid={uid}
        />
      )}

      {(state === "active" || state === "ended" || state === "adjudicated") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            {challenge.frequency.type === "daily" ? (
              <DailyHistoryGrid
                challenge={challenge}
                checkinYmds={checkinYmds}
                today={today}
              />
            ) : (
              <WeeklyWindowList
                challenge={challenge}
                checkinYmds={checkinYmds}
                today={today}
              />
            )}
          </CardContent>
        </Card>
      )}

      {state !== "cancelled" && state !== "adjudicated" && (
        <p className="text-center text-xs text-muted-foreground">
          {challenge.forfeitType === "pool"
            ? `If you fail, your ${formatAmount(challenge.stakeAmount)} is split among the members who succeed.`
            : `If you fail, you owe ${formatAmount(challenge.stakeAmount)} to ${member?.charityName ?? challenge.charityName ?? "your charity"}.`}
        </p>
      )}
    </div>
  );
}

function MembersCard({
  challenge,
  members,
  allCheckins,
  today,
  selfUid,
}: {
  challenge: Challenge;
  members: ({ uid: string } & ChallengeMember)[];
  allCheckins: { uid: string; localDate: string }[];
  today: string;
  selfUid: string;
}) {
  const total = totalRequired(challenge);
  const state = challengeState(challenge, today);

  const rows = members.map((m) => {
    const ymds = allCheckins
      .filter((c) => c.uid === m.uid)
      .map((c) => c.localDate)
      .filter((d) => d >= challenge.startDate && d <= challenge.endDate);
    const used = skipsUsed(challenge, ymds, today);
    return {
      ...m,
      completed: m.outcome !== null ? m.completedCount : ymds.length,
      onTrack: used <= challenge.skipDays,
    };
  });
  const onTrackCount = rows.filter((r) => r.onTrack).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Members</CardTitle>
        {state === "active" && (
          <CardDescription>
            {onTrackCount} of {rows.length} on track
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.uid} className="flex items-center gap-3">
            <span
              className={
                "flex-1 truncate text-sm " +
                (row.uid === selfUid ? "font-semibold" : "")
              }
            >
              {row.displayName}
              {row.uid === selfUid ? " (you)" : ""}
            </span>
            {row.outcome === "succeeded" && (
              <span className="text-xs font-medium text-primary">Succeeded ✓</span>
            )}
            {row.outcome === "failed" && (
              <span className="text-xs font-medium text-destructive">Failed ✗</span>
            )}
            {row.outcome === null && (
              <>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${total > 0 ? Math.min(100, (row.completed / total) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="w-10 text-right text-xs text-muted-foreground">
                  {row.completed}/{total}
                </span>
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DailyHistoryGrid({
  challenge,
  checkinYmds,
  today,
}: {
  challenge: Challenge;
  checkinYmds: string[];
  today: string;
}) {
  const entries = dailyHistory(challenge, new Set(checkinYmds), today);
  return (
    <div className="grid grid-cols-7 gap-2">
      {entries.map((entry) => (
        <div
          key={entry.ymd}
          title={`${formatYmd(entry.ymd)}: ${entry.state}`}
          className={
            "flex h-9 items-center justify-center rounded-md text-xs " +
            (entry.state === "done"
              ? "bg-primary text-primary-foreground"
              : entry.state === "missed"
                ? "bg-destructive/15 text-destructive"
                : entry.state === "today"
                  ? "border-2 border-primary text-foreground"
                  : "bg-secondary text-muted-foreground")
          }
        >
          {formatYmd(entry.ymd, "d")}
        </div>
      ))}
    </div>
  );
}

function WeeklyWindowList({
  challenge,
  checkinYmds,
  today,
}: {
  challenge: Challenge;
  checkinYmds: string[];
  today: string;
}) {
  const windows = weeklyWindows(challenge, checkinYmds, today);
  return (
    <div className="flex flex-col gap-2">
      {windows.map((w) => (
        <div
          key={w.index}
          className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
        >
          <span>
            Week {w.index} · {formatYmd(w.start)} – {formatYmd(w.end)}
          </span>
          <span
            className={
              w.state === "complete"
                ? "font-medium text-primary"
                : w.state === "past-incomplete"
                  ? "font-medium text-destructive"
                  : "text-muted-foreground"
            }
          >
            {w.count}/{w.target}
          </span>
        </div>
      ))}
    </div>
  );
}
