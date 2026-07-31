"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/client";
import { myReflectionsQuery } from "@/lib/reflections";
import {
  cancelChallenge,
  deleteChallenge,
  removeMember,
  respondToJoinRequest,
  setJoinClosed,
  setChallengeVisibility,
} from "@/lib/challenges";
import { useUserTimezone } from "@/hooks/use-user-timezone";
import {
  challengeState,
  dailyHistory,
  progressSummary,
  recentWindow,
  skipsUsed,
  totalRequired,
  weeklyWindows,
} from "@/lib/progress";
import Link from "next/link";
import { addDaysYmd, daysBetweenInclusive, formatYmd, todayYmd } from "@/lib/dates";
import { formatAmount } from "@/lib/currency";
import { useChainStreak } from "@/hooks/use-chain-streak";
import type { Challenge, ChallengeMember, JoinRequest, Reflection } from "@/lib/types";
import { CheckinDialog } from "@/components/checkin-dialog";
import { EditChallengeDialog } from "@/components/edit-challenge-dialog";
import { MissReasonDialog } from "@/components/miss-reason-dialog";
import { RateSessionDialog } from "@/components/rate-session-dialog";
import { RepeatChallengeDialog } from "@/components/repeat-challenge-dialog";
import { SessionRatingsCard } from "@/components/session-ratings-card";
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
  const [togglingJoin, setTogglingJoin] = useState(false);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  /** yyyymmdd of the missed day/window currently being explained, if any. */
  const [missDate, setMissDate] = useState<string | null>(null);

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
  const today = todayYmd(timezone);
  // Hook, so it has to run unconditionally — ahead of the loading/not-found
  // early returns below, which is why it takes a possibly-null challenge.
  const { streak: creatorStreak, weeks: creatorWeeks } = useChainStreak(
    challenge,
    uid,
    checkinYmds,
    today,
    member?.joinedDate
  );
  const reflectionsByDate = useMemo(
    () => new Map(reflections.map((r) => [r.localDate, r])),
    [reflections]
  );

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

  const state = challengeState(challenge, today);
  const summary = progressSummary(challenge, checkinYmds, timezone, member?.joinedDate);
  const isCreator = challenge.createdBy === uid;
  // Cancel (soft: keeps a "Cancelled" record) only makes sense for group
  // challenges, where other members might already be watching for one. A
  // solo challenge has no one else to show a cancelled record to — Delete
  // (below) supersedes it there.
  const canCancel = isCreator && state === "upcoming" && challenge.mode === "group";
  // Same "terms are frozen once anyone else has joined" gate as canEdit
  // below — a group challenge is only fully deletable while the creator
  // is still its sole member; once someone else has joined, Cancel is the
  // only way out (it keeps a record they can see). Solo has no such
  // restriction, and — unlike canEdit — no status restriction either: a
  // solo challenge affects no one but its creator regardless of state.
  const canDelete =
    isCreator && (challenge.mode === "solo" || challenge.memberIds.length === 1);
  // Same "terms are frozen once anyone else has joined" rule the app
  // already applies elsewhere (firestore.rules' challenges/{cid} update
  // block) — group challenges are only editable pre-join; solo has no one
  // else to protect, so it's editable any time it's still running.
  const canEdit =
    isCreator &&
    (state === "upcoming" || state === "active") &&
    (challenge.mode === "solo" || challenge.memberIds.length === 1);
  // Mutually exclusive with canEdit above (upcoming/active vs. ended) — the
  // creator can start a new cycle once this one is over, with the same
  // settings carried forward and (for group habits) every prior member
  // carried over automatically.
  const canRepeat = isCreator && (state === "ended" || state === "adjudicated");

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

  async function handleToggleJoinClosed(nextClosed: boolean) {
    setTogglingJoin(true);
    setError(null);
    try {
      await setJoinClosed(id, nextClosed);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't update joining for this challenge."
      );
    } finally {
      setTogglingJoin(false);
    }
  }

  async function handleToggleVisibility(next: "public" | "private") {
    setTogglingVisibility(true);
    setError(null);
    try {
      await setChallengeVisibility(id, next);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't update this habit's visibility."
      );
    } finally {
      setTogglingVisibility(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">{challenge.name}</h2>
          {challenge.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {challenge.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
          {challenge.mode === "group" && (
            <Badge variant="outline">
              {challenge.forfeitType === "pool" ? "Winner pool" : "Group"}
            </Badge>
          )}
          {creatorStreak > 0 && (
            <Badge variant="volt">
              Streak {creatorStreak}
              {creatorWeeks > 0 && ` · ${creatorWeeks}w`}
            </Badge>
          )}
          <Badge variant="secondary">
            {state === "upcoming" && "Not started"}
            {state === "active" && "Active"}
            {state === "ended" && "Ended"}
            {state === "cancelled" && "Cancelled"}
            {state === "adjudicated" && "Complete"}
          </Badge>
          {canEdit && (
            <EditChallengeDialog challenge={challenge} currentStreak={creatorStreak} />
          )}
          {canRepeat && (
            <RepeatChallengeDialog
              challenge={challenge}
              today={today}
              memberCount={members?.length ?? 1}
            />
          )}
        </div>
      </div>

      {challenge.mode === "group" &&
        challenge.joinCode &&
        (state === "upcoming" || state === "active") &&
        (!challenge.joinClosed || isCreator) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Invite friends</CardTitle>
              <CardDescription>
                {challenge.joinClosed
                  ? "Joining is closed — reopen it to let more people in."
                  : "Share this link — joining stays open until you close it."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!challenge.joinClosed && (
                <div className="flex items-center gap-3">
                  <code className="rounded-full bg-ink px-4 py-1.5 font-mono text-sm font-bold tracking-widest text-primary">
                    {challenge.joinCode}
                  </code>
                  <ShareLink joinCode={challenge.joinCode} name={challenge.name} />
                </div>
              )}
              {isCreator && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => handleToggleJoinClosed(!challenge.joinClosed)}
                  disabled={togglingJoin}
                >
                  {togglingJoin
                    ? "Updating…"
                    : challenge.joinClosed
                      ? "Reopen joining"
                      : "Close joining"}
                </Button>
              )}
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
                {challenge.joinClosed && " — joining is closed, so these can only be rejected"}
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
                    disabled={respondingUid === req.uid || challenge.joinClosed === true}
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
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">Checked in today ✓</p>
                {/* The check-in sheet is gone by now and can't be reopened for
                    today, so this is the only way to rate a session you didn't
                    rate in the moment — or to fix one you mistyped. */}
                <RateSessionDialog
                  challengeId={id}
                  uid={uid}
                  date={today}
                  dateLabel={formatYmd(today, "EEE, MMM d")}
                  current={reflectionsByDate.get(today)?.rating ?? null}
                  onError={setError}
                />
              </div>
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
            <CardDescription>
              Tap anything you missed to note what got in the way — just for
              you, and it won&apos;t change the result.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {challenge.frequency.type === "daily" ? (
              <DailyHistoryGrid
                challenge={challenge}
                checkinYmds={checkinYmds}
                today={today}
                memberJoinedDate={member?.joinedDate}
                reflectionsByDate={reflectionsByDate}
                onSelectMiss={setMissDate}
              />
            ) : (
              <WeeklyWindowList
                challenge={challenge}
                checkinYmds={checkinYmds}
                today={today}
                memberJoinedDate={member?.joinedDate}
                reflectionsByDate={reflectionsByDate}
                onSelectMiss={setMissDate}
              />
            )}
          </CardContent>
        </Card>
      )}

      {(state === "active" || state === "ended" || state === "adjudicated") && (
        <SessionRatingsCard reflections={reflections} />
      )}

      <MissReasonDialog
        challengeId={id}
        uid={uid}
        date={missDate}
        dateLabel={missDateLabel(challenge, missDate)}
        existing={missDate ? reflectionsByDate.get(missDate) : undefined}
        onClose={() => setMissDate(null)}
        onError={setError}
      />


      {state !== "cancelled" && state !== "adjudicated" && (
        <p className="text-center text-xs text-muted-foreground">
          {challenge.forfeitType === "pool"
            ? `If you fail, your ${formatAmount(challenge.stakeAmount)} is split among the members who succeed.`
            : `If you fail, you owe ${formatAmount(challenge.stakeAmount)} to ${member?.charityName ?? challenge.charityName ?? "your charity"}.`}
        </p>
      )}

      {/* Creator-only, and available even after friends have joined —
          "they joined and now I'd rather this wasn't public" is the whole
          point (see setChallengeVisibilityAdmin). */}
      {isCreator && challenge.status === "active" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Leaderboard</CardTitle>
            <CardDescription>
              {challenge.visibility === "private"
                ? challenge.mode === "group"
                  ? "Private — this habit's streak only counts for people in it."
                  : "Private — this habit's streak only counts for you."
                : "This habit's streak counts toward your rank on other people's leaderboards."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              disabled={togglingVisibility}
              onClick={() =>
                handleToggleVisibility(
                  challenge.visibility === "private" ? "public" : "private"
                )
              }
            >
              {togglingVisibility
                ? "Updating…"
                : challenge.visibility === "private"
                  ? "Count on leaderboards"
                  : "Make private"}
            </Button>
          </CardContent>
        </Card>
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
  const state = challengeState(challenge, today);

  // Per-member, not shared: a member who joined after the challenge started
  // has a smaller total (and a later skips-used floor) than one who's been
  // in since day one — see effectiveStart in lib/progress.ts.
  const rows = members.map((m) => {
    const ymds = allCheckins
      .filter((c) => c.uid === m.uid)
      .map((c) => c.localDate)
      .filter((d) => d >= challenge.startDate && d <= challenge.endDate);
    const used = skipsUsed(challenge, ymds, today, m.joinedDate);
    return {
      ...m,
      completed: m.outcome !== null ? m.completedCount : ymds.length,
      total: totalRequired(challenge, m.joinedDate),
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
                      width: `${row.total > 0 ? Math.min(100, (row.completed / row.total) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="w-10 text-right text-xs text-muted-foreground">
                  {row.completed}/{row.total}
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

/**
 * What the miss dialog calls the thing being explained. Weekly habits miss a
 * *window*, not a day — the reflection is keyed on the window's start date,
 * so the label has to name the week rather than that one date, or it would
 * look like the app blamed you for a Monday.
 */
function missDateLabel(challenge: Challenge, ymd: string | null): string {
  if (!ymd) return "";
  if (challenge.frequency.type === "daily") return formatYmd(ymd, "EEE, MMM d");
  return `${formatYmd(ymd)} – ${formatYmd(addDaysYmd(ymd, 6))}`;
}

interface HistoryReflectionProps {
  reflectionsByDate: Map<string, Reflection>;
  onSelectMiss: (ymd: string) => void;
}

/**
 * How much history stays on screen before it has to be asked for. Eight weeks
 * is deliberately above the old 4-week maximum duration, so every habit that
 * could exist before year-long ones were allowed still renders whole.
 */
const COLLAPSED_HISTORY_WEEKS = 8;

function DailyHistoryGrid({
  challenge,
  checkinYmds,
  today,
  memberJoinedDate,
  reflectionsByDate,
  onSelectMiss,
}: {
  challenge: Challenge;
  checkinYmds: string[];
  today: string;
  memberJoinedDate?: string;
} & HistoryReflectionProps) {
  const [showAll, setShowAll] = useState(false);
  const all = dailyHistory(challenge, new Set(checkinYmds), today, memberJoinedDate);
  const { start, end } = recentWindow(
    all.length,
    all.findIndex((e) => e.ymd === today),
    COLLAPSED_HISTORY_WEEKS * 7,
    7
  );
  const collapsible = end - start < all.length;
  const entries = showAll || !collapsible ? all : all.slice(start, end);

  return (
    <>
    <div className="grid grid-cols-7 gap-2">
      {entries.map((entry) => {
        const explained = Boolean(reflectionsByDate.get(entry.ymd)?.missReason);
        const cellClass =
          "flex h-9 items-center justify-center rounded-md text-xs " +
          (entry.state === "done"
            ? "bg-foreground text-background"
            : entry.state === "missed"
              ? "bg-destructive/15 text-destructive"
              : entry.state === "today"
                ? "border-2 border-primary text-foreground"
                : "bg-secondary text-muted-foreground");

        if (entry.state !== "missed") {
          return (
            <div
              key={entry.ymd}
              title={`${formatYmd(entry.ymd)}: ${entry.state}`}
              className={cellClass}
            >
              {formatYmd(entry.ymd, "d")}
            </div>
          );
        }

        return (
          <button
            key={entry.ymd}
            type="button"
            onClick={() => onSelectMiss(entry.ymd)}
            title={`${formatYmd(entry.ymd)}: missed${explained ? " — reason noted" : ""}`}
            aria-label={`${formatYmd(entry.ymd)}: missed. ${
              explained ? "Reason noted — edit it." : "Note what got in the way."
            }`}
            className={
              cellClass +
              " relative transition-colors hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" +
              (explained ? " ring-1 ring-destructive/40" : "")
            }
          >
            {formatYmd(entry.ymd, "d")}
            {explained && (
              <span
                aria-hidden
                className="absolute bottom-1 h-1 w-1 rounded-full bg-destructive"
              />
            )}
          </button>
        );
      })}
    </div>
    {collapsible && (
      <Button
        variant="ghost"
        size="sm"
        className="mt-3 w-full"
        onClick={() => setShowAll((v) => !v)}
      >
        {showAll
          ? `Show recent ${COLLAPSED_HISTORY_WEEKS} weeks`
          : `Show all ${all.length} days`}
      </Button>
    )}
    </>
  );
}

function WeeklyWindowList({
  challenge,
  checkinYmds,
  today,
  memberJoinedDate,
  reflectionsByDate,
  onSelectMiss,
}: {
  challenge: Challenge;
  checkinYmds: string[];
  today: string;
  memberJoinedDate?: string;
} & HistoryReflectionProps) {
  const [showAll, setShowAll] = useState(false);
  const all = weeklyWindows(challenge, checkinYmds, today, memberJoinedDate);
  const { start, end } = recentWindow(
    all.length,
    all.findIndex((w) => w.state === "current"),
    COLLAPSED_HISTORY_WEEKS
  );
  const collapsible = end - start < all.length;
  const windows = showAll || !collapsible ? all : all.slice(start, end);

  return (
    <>
    <div className="flex flex-col gap-2">
      {windows.map((w) => {
        // A weekly habit misses a window, not a day, so the reflection for one
        // is keyed on the window's start date.
        const explained = Boolean(reflectionsByDate.get(w.start)?.missReason);
        // Without this, a prorated week reads as "2/2" beside its neighbours'
        // "5/5" with nothing to explain the different denominator — which
        // looks like a bug rather than the fairness adjustment it is.
        const proratedNote = w.prorated
          ? `You joined partway through this week, so ${w.target} of the usual ${challenge.frequency.target} were required.`
          : undefined;
        const label = (
          <>
            <span className="min-w-0">
              Week {w.index} · {formatYmd(w.start)} – {formatYmd(w.end)}
              {w.prorated && (
                <span className="text-muted-foreground"> · joined mid-week</span>
              )}
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
          </>
        );

        if (w.state !== "past-incomplete") {
          return (
            <div
              key={w.index}
              title={proratedNote}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              {label}
            </div>
          );
        }

        return (
          <button
            key={w.index}
            type="button"
            onClick={() => onSelectMiss(w.start)}
            title={proratedNote}
            aria-label={`Week ${w.index}, ${w.count} of ${w.target}. ${
              proratedNote ? proratedNote + " " : ""
            }${explained ? "Reason noted — edit it." : "Note what got in the way."}`}
            className={
              "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" +
              (explained ? " border-destructive/40" : "")
            }
          >
            {label}
          </button>
        );
      })}
    </div>
    {collapsible && (
      <Button
        variant="ghost"
        size="sm"
        className="mt-3 w-full"
        onClick={() => setShowAll((v) => !v)}
      >
        {showAll
          ? `Show recent ${COLLAPSED_HISTORY_WEEKS} weeks`
          : `Show all ${all.length} weeks`}
      </Button>
    )}
    </>
  );
}
