"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import {
  cancelChallenge,
  deleteChallenge,
  removeMember,
  respondToJoinRequest,
} from "@/lib/challenges";
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
import type { Challenge, ChallengeMember, JoinRequest } from "@/lib/types";
import { CheckinDialog } from "@/components/checkin-dialog";
import { ShareLink } from "@/components/share-link";
import { Badge } from "@/components/ui/badge";
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
  const [joinRequests, setJoinRequests] = useState<
    ({ uid: string } & JoinRequest)[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [respondingUid, setRespondingUid] = useState<string | null>(null);
  const [removingUid, setRemovingUid] = useState<string | null>(null);

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
  // Cancel (soft: keeps a "Cancelled" record) only makes sense for group
  // challenges, where other members might already be watching for one. A
  // solo challenge has no one else to show a cancelled record to — Delete
  // (below) supersedes it there.
  const canCancel = isCreator && state === "upcoming" && challenge.mode === "group";
  const canDelete = isCreator && challenge.mode === "solo";

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

  async function handleDelete() {
    if (!window.confirm("Delete this challenge? This can't be undone.")) return;
    setDeleting(true);
    try {
      await deleteChallenge(id);
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't delete the challenge."
      );
      setDeleting(false);
    }
  }

  async function handleRespond(targetUid: string, action: "approve" | "reject") {
    setRespondingUid(targetUid);
    setError(null);
    try {
      await respondToJoinRequest(id, targetUid, action);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't respond to that request."
      );
    } finally {
      setRespondingUid(null);
    }
  }

  async function handleRemove(targetUid: string) {
    if (!window.confirm("Remove this member from the challenge?")) return;
    setRemovingUid(targetUid);
    setError(null);
    try {
      await removeMember(id, targetUid);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that member.");
    } finally {
      setRemovingUid(null);
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
            <Badge variant="outline">
              {challenge.forfeitType === "pool" ? "Winner pool" : "Group"}
            </Badge>
          )}
          <Badge variant="secondary">
            {state === "upcoming" && "Not started"}
            {state === "active" && "Active"}
            {state === "ended" && "Ended"}
            {state === "cancelled" && "Cancelled"}
            {state === "adjudicated" && "Complete"}
          </Badge>
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
            <code className="rounded-full bg-ink px-4 py-1.5 font-mono text-sm font-bold tracking-widest text-primary">
              {challenge.joinCode}
            </code>
            <ShareLink joinCode={challenge.joinCode} name={challenge.name} />
          </CardContent>
        </Card>
      )}

      {isCreator &&
        challenge.mode === "group" &&
        (challenge.joinPolicy ?? "open") === "invite" &&
        joinRequests &&
        joinRequests.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Requests</CardTitle>
              <CardDescription>
                {joinRequests.length} pending request
                {joinRequests.length === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {joinRequests.map((req) => (
                <div key={req.uid} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {req.displayName}
                    {req.username && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        @{req.username}
                      </span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={respondingUid === req.uid}
                    onClick={() => handleRespond(req.uid, "reject")}
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    disabled={respondingUid === req.uid}
                    onClick={() => handleRespond(req.uid, "approve")}
                  >
                    Approve
                  </Button>
                </div>
              ))}
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
                className="h-full rounded-full bg-foreground transition-all"
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
          isCreator={isCreator}
          removingUid={removingUid}
          onRemove={handleRemove}
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

      {canDelete && (
        <div className="flex justify-center pt-2">
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete challenge"}
          </Button>
        </div>
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
  isCreator,
  removingUid,
  onRemove,
}: {
  challenge: Challenge;
  members: ({ uid: string } & ChallengeMember)[];
  allCheckins: { uid: string; localDate: string }[];
  today: string;
  selfUid: string;
  isCreator: boolean;
  removingUid: string | null;
  onRemove: (uid: string) => void;
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
            <span className="flex-1 truncate text-sm">
              <span className={row.uid === selfUid ? "font-semibold" : ""}>
                {row.displayName}
                {row.uid === selfUid ? " (you)" : ""}
              </span>
              {row.username && (
                <span className="ml-1 text-xs text-muted-foreground">
                  @{row.username}
                </span>
              )}
            </span>
            {row.outcome === "succeeded" && (
              <span className="text-xs font-bold text-foreground">Succeeded ✓</span>
            )}
            {row.outcome === "failed" && (
              <span className="text-xs font-medium text-destructive">Failed ✗</span>
            )}
            {row.outcome === null && (
              <>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-foreground"
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
            {isCreator && row.uid !== selfUid && state === "active" && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={removingUid === row.uid}
                onClick={() => onRemove(row.uid)}
              >
                {removingUid === row.uid ? "Removing…" : "Remove"}
              </Button>
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
              ? "bg-foreground text-background"
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
                ? "font-bold text-foreground"
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
