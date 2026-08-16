"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  backfillCheckIn,
  cancelChallenge,
  deleteChallenge,
  removeMember,
  respondToJoinRequest,
  setJoinClosed,
  setAutoRepeat,
  setChallengeVisibility,
  setMemberExclusion,
  setSpare,
} from "@/lib/challenges";
import { useHabitDate } from "@/hooks/use-habit-date";
import { useUserSettings } from "@/hooks/use-user-settings";
import {
  challengeState,
  habitWeek,
  progressSummary,
  weeklyWindows,
} from "@/lib/progress";
import { addDaysYmd, daysBetweenInclusive, formatYmd } from "@/lib/dates";
import { canEarnBadges, skipAllowance } from "@/lib/badges";
import {
  challengeTakesSpares,
  spareRoom,
  sparesByWindow,
  totalSparesApplied,
  unprotectedMisses,
} from "@/lib/spares";
import { repeatDurationDays } from "@/lib/duration";
import { chainWeekOffsets } from "@/lib/cycles";
import { canBackfill } from "@/lib/backfill";
import { awayDaysFor, awaySummary, memberTimeOff } from "@/lib/away";
import { challengePermissions } from "@/lib/challenge-permissions";
import { useChainStreak } from "@/hooks/use-chain-streak";
import { useChallengeDoc } from "@/hooks/use-challenge-doc";
import { usePastCycles } from "@/hooks/use-past-cycles";
import { CheckinDialog } from "@/components/checkin-dialog";
import { EditChallengeDialog } from "@/components/edit-challenge-dialog";
import { HabitWeekStrip } from "@/components/habit-week-strip";
import {
  MissReasonDialog,
  type SpareOffer,
} from "@/components/miss-reason-dialog";
import { RateSessionDialog } from "@/components/rate-session-dialog";
import { RepeatChallengeDialog } from "@/components/repeat-challenge-dialog";
import { SessionRatingsCard } from "@/components/session-ratings-card";
import {
  HistoryCard,
  missTargetLabel,
  type MissTarget,
} from "@/components/challenge/history-card";
import { MembersCard } from "@/components/challenge/members-card";
import { ChallengeStatusCards } from "@/components/challenge/status-cards";
import { ChallengeSettingsCard } from "@/components/challenge/settings-card";
import { SpareAllowance } from "@/components/challenge/spare-allowance";
import { InviteDialog } from "@/components/invite-dialog";
import { StakesCard } from "@/components/stakes-card";
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
  const { timezone, awayRanges } = useUserSettings(uid);
  const {
    challenge,
    allCheckins,
    checkinsLoaded,
    members,
    member,
    joinRequests,
    reflections,
    spares,
  } = useChallengeDoc(id, uid);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [respondingUid, setRespondingUid] = useState<string | null>(null);
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [excludingUid, setExcludingUid] = useState<string | null>(null);
  const [togglingJoin, setTogglingJoin] = useState(false);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [togglingAutoRepeat, setTogglingAutoRepeat] = useState(false);
  /** The missed day or window currently open in the dialog, if any. */
  const [missTarget, setMissTarget] = useState<MissTarget | null>(null);

  const checkinYmds = allCheckins
    .filter((c) => c.uid === uid)
    .map((c) => c.localDate);
  // Live, not computed once at render: this page owns its own listeners
  // rather than reading the shell's, so nothing else would refresh the date
  // for it. Someone sitting on a habit page across 3am — or resuming the
  // installed app on it the next morning — would otherwise rate and check in
  // against yesterday. See useHabitDate.
  const today = useHabitDate(timezone);
  // One derivation for the whole page, memoised on the ranges rather than
  // recomputed at each call site — the same discipline ActivityProvider
  // applies for the shell, and for the same reason: a second derivation is a
  // second chance to disagree about which days were excused.
  // Both routes out of a cycle, resolved once: the creator excusing this
  // member, and their own booked time off. See memberTimeOff.
  const away = useMemo(
    () =>
      challenge
        ? memberTimeOff(
            challenge,
            awayRanges,
            member?.joinedDate,
            member?.excluded
          ).days
        : undefined,
    [challenge, awayRanges, member?.joinedDate, member?.excluded]
  );
  // Hook, so it has to run unconditionally — ahead of the loading/not-found
  // early returns below, which is why it takes a possibly-null challenge.
  const {
    streak: creatorStreak,
    weeks: creatorWeeks,
    pending: streakPending,
  } = useChainStreak(
    challenge,
    uid,
    checkinYmds,
    today,
    member?.joinedDate,
    away
  );
  const rawPastCycles = usePastCycles(challenge, uid);
  // Week numbers come from the chain that's actually on screen, not from each
  // cycle's stored `weeksBefore` — see chainWeekOffsets. Every cycle in the
  // chain is corrected, not just this one: on a three-cycle habit whose
  // middle cycle predates the field, fixing only the newest would still leave
  // week 1 appearing twice in the middle of the list.
  const { pastCycles, weekChallenge } = useMemo(() => {
    if (!challenge) return { pastCycles: rawPastCycles, weekChallenge: challenge };
    const chain = [...rawPastCycles.map((p) => p.challenge), challenge];
    const offsets = chainWeekOffsets(chain);
    return {
      pastCycles: rawPastCycles.map((p, i) => ({
        ...p,
        challenge: { ...p.challenge, weeksBefore: offsets[i] },
        away: awayDaysFor(p.challenge, awayRanges, p.joinedDate),
      })),
      weekChallenge: { ...challenge, weeksBefore: offsets[offsets.length - 1] },
    };
  }, [challenge, rawPastCycles, awayRanges]);
  const reflectionsByDate = useMemo(
    () => new Map(reflections.map((r) => [r.localDate, r])),
    [reflections]
  );
  const spareCoverage = useMemo(() => sparesByWindow(spares), [spares]);
  const sparesApplied = useMemo(() => totalSparesApplied(spares), [spares]);

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
  const summary = progressSummary(
    challenge,
    checkinYmds,
    timezone,
    member?.joinedDate,
    away
  );
  const timeOff = awaySummary(challenge, awayRanges, member?.joinedDate);
  // weekChallenge, not challenge: the strip prints "Week N of M", so it has to
  // agree with the History list underneath it about which week this is.
  const currentWeek = habitWeek(
    weekChallenge ?? challenge,
    checkinYmds,
    today,
    member?.joinedDate,
    away
  );
  // Spares are spent deliberately now, so this screen carries two numbers
  // rather than one: what's protecting the stake (allowance.total) and what's
  // still in the bank to spend (allowance.available).
  const allowance = skipAllowance(
    challenge,
    checkinYmds,
    today,
    member?.joinedDate,
    member?.badgesCarried,
    sparesApplied,
    away
  );
  const atRisk = unprotectedMisses(
    summary.skipsUsed,
    allowance.base,
    allowance.applied
  );
  const takesSpares = challengeTakesSpares(challenge);
  // What the miss sheet can offer for the week it currently has open. Built
  // here rather than inside the dialog so every bound on spending a spare —
  // this week's remaining shortfall, and the balance across the whole habit —
  // is decided in the same place as the numbers it's decided from.
  let spareOffer: SpareOffer | undefined;
  if (takesSpares && missTarget?.kind === "window") {
    const windowStart = missTarget.ymd;
    const window = weeklyWindows(
      challenge,
      checkinYmds,
      today,
      member?.joinedDate,
      away
    ).find((w) => w.start === windowStart);
    if (window) {
      const appliedHere = spareCoverage.get(windowStart) ?? 0;
      spareOffer = {
        applied: appliedHere,
        room: spareRoom(window, appliedHere),
        available: allowance.available,
        onSet: (count) => handleSetSpare(windowStart, count),
      };
    }
  }
  const {
    isCreator,
    canCancel,
    canDelete,
    canEdit,
    canRepeat,
    canSetAutoRepeat,
    inviteCode,
  } = challengePermissions(challenge, uid, state);
  const nextCycleStart = addDaysYmd(challenge.endDate, 1);
  const nextCycleWeeks =
    repeatDurationDays(
      daysBetweenInclusive(challenge.startDate, challenge.endDate)
    ) / 7;

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

  // No window.confirm: the member sheet confirms in place, and it can say the
  // thing a native dialog can't — that removal also covers the repeats after
  // this one.
  async function handleRemove(targetUid: string) {
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

  /**
   * Excuse a member from this cycle, or put them back. Awaited rather than
   * optimistic: it decides whether someone's stake is live, and the members
   * listener reflects it as soon as the write lands.
   */
  async function handleSetExclusion(targetUid: string, excluded: boolean) {
    setExcludingUid(targetUid);
    setError(null);
    try {
      await setMemberExclusion(id, targetUid, excluded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that.");
    } finally {
      setExcludingUid(null);
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

  async function handleToggleAutoRepeat(next: boolean) {
    setTogglingAutoRepeat(true);
    setError(null);
    try {
      await setAutoRepeat(id, next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't update auto-repeat."
      );
    } finally {
      setTogglingAutoRepeat(false);
    }
  }

  /**
   * Log a missed day. Optimistic and not awaited, like the live check-in:
   * the local cache updates the page's listener at once, so the cell fills
   * immediately, and a rules rejection reverts it and surfaces here.
   */
  function handleBackfill(ymd: string) {
    if (!challenge) return;
    setError(null);
    backfillCheckIn(challenge, uid, ymd).catch(() => {
      setError(
        "Couldn't log that day. It may already be recorded, or this habit may " +
          "have been graded since you opened the page."
      );
    });
  }

  /**
   * Spend banked spares on one missed week, or take them back with 0.
   *
   * Awaited, unlike a check-in or a backfill: this one goes through the
   * server, so there's no local cache write to make the change appear
   * optimistically — the listener only updates once the round trip lands, and
   * pretending otherwise would flash a coverage mark that might not stick.
   */
  async function handleSetSpare(windowStart: string, count: number) {
    setError(null);
    try {
      await setSpare(id, windowStart, count);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't update that spare."
      );
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
          {/* No "continues an earlier cycle" line here any more. It announced
              something the screen already demonstrates — the history runs
              straight through the earlier cycles and the week numbers keep
              counting — and the carried skips it mentioned are itemised in
              the allowance line below, where the rest of the arithmetic is. */}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
          {challenge.mode === "group" && (
            <Badge variant="outline">
              {challenge.forfeitType === "pool" ? "Winner pool" : "Group"}
            </Badge>
          )}
          {/* Held back rather than shown provisionally — on a repeated habit
              the local figure is only this cycle's, and this badge is the
              screen's headline claim about the streak. */}
          {!streakPending && creatorStreak > 0 && (
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
          {inviteCode && (
            <InviteDialog
              joinCode={inviteCode}
              name={challenge.name}
              joinClosed={challenge.joinClosed === true}
              isCreator={isCreator}
              toggling={togglingJoin}
              onToggleJoinClosed={handleToggleJoinClosed}
            />
          )}
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

      {/* Top of the screen, where the reason any of this works belongs — it
          spent its life as a grey footnote under the ratings chart. */}
      {state !== "cancelled" && state !== "adjudicated" && (
        <StakesCard
          amount={challenge.stakeAmount}
          forfeitType={challenge.forfeitType}
          charityName={member?.charityName ?? challenge.charityName}
          autoRepeats={!isCreator && challenge.autoRepeat === true}
          // The creator's decision first, matching memberTimeOff: an excusal
          // covers the whole cycle, so what the member happened to book can't
          // add to it and shouldn't change what they're told.
          outOfCycle={
            member?.excluded ? "excused" : timeOff.steppedOut ? "away" : null
          }
        />
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

      <ChallengeStatusCards
        challenge={challenge}
        state={state}
        member={member}
        canCancel={canCancel}
        cancelling={cancelling}
        onCancel={handleCancel}
        today={today}
      />
      {(state === "active" || state === "ended" || state === "adjudicated") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>
              {summary.completed} of {summary.total} check-ins
            </CardTitle>
            <CardDescription>
              {state === "active" &&
                // "N of M skips used" broke the moment spares stopped being
                // spent automatically: an uncovered miss now reads "1 of 0",
                // because the allowance is what's actually protecting you
                // rather than everything you could protect yourself with.
                `${summary.daysRemaining} day${summary.daysRemaining === 1 ? "" : "s"} remaining · ${summary.skipsUsed} miss${summary.skipsUsed === 1 ? "" : "es"} · ${allowance.total} allowed`}
              {state === "ended" && "Ended — results land in the next day or two"}
              {state === "adjudicated" &&
                `${formatYmd(challenge.startDate)} – ${formatYmd(challenge.endDate)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={
                  "h-full rounded-full bg-foreground" +
                  (checkinsLoaded ? " transition-all" : "")
                }
                style={{
                  width: `${summary.total > 0 ? Math.min(100, (summary.completed / summary.total) * 100) : 0}%`,
                }}
              />
            </div>
            {/* The habit's own week, not the calendar's — a Friday-start habit
                runs Friday to Thursday, and until now nothing on this screen
                said so. Sits under the overall bar because it answers the
                nearer question: what's left in the week you're actually in. */}
            {currentWeek && (
              <div className="mt-1">
                <HabitWeekStrip
                  week={currentWeek}
                  onSelectMissedDay={(ymd) => setMissTarget({ ymd, kind: "day" })}
                />
              </div>
            )}
            {member?.excluded && (
              <p className="text-xs font-medium text-foreground">
                You&apos;re excused from this cycle — nothing is due, and your
                stake isn&apos;t in play.
              </p>
            )}
            {!member?.excluded && timeOff.booked > 0 && (
              <p
                className={
                  "text-xs " +
                  (timeOff.steppedOut ? "text-foreground" : "text-muted-foreground")
                }
              >
                {timeOff.steppedOut ? (
                  <>
                    <span className="font-medium">
                      You&apos;re out of this habit
                    </span>{" "}
                    from {formatYmd(timeOff.outFrom!)} to{" "}
                    {formatYmd(timeOff.outTo!)}. That&apos;s past this
                    habit&apos;s {timeOff.budget} days of cover, so you sit the
                    cycle out — no result, and no stake either way.
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">
                      {timeOff.booked} day{timeOff.booked === 1 ? "" : "s"} off
                    </span>{" "}
                    booked — those days aren&apos;t counted or missed.
                  </>
                )}
              </p>
            )}
            {canEarnBadges(challenge) && !member?.excluded && (
              <SpareAllowance
                allowance={allowance}
                atRisk={atRisk}
                canSpend={takesSpares}
              />
            )}
            {summary.canCheckInToday && (
              <div>
                <CheckinDialog
                  challenge={challenge}
                  uid={uid}
                  today={today}
                  timezone={timezone}
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
          excludingUid={excludingUid}
          onSetExclusion={handleSetExclusion}
        />
      )}

      {(state === "active" || state === "ended" || state === "adjudicated") && (
        <HistoryCard
          challenge={challenge}
          weekChallenge={weekChallenge ?? challenge}
          checkinYmds={checkinYmds}
          today={today}
          memberJoinedDate={member?.joinedDate}
          away={away}
          pastCycles={pastCycles}
          sparesByWindow={spareCoverage}
          spareAvailable={takesSpares && allowance.available > 0}
          reflectionsByDate={reflectionsByDate}
          onSelectMiss={setMissTarget}
        />
      )}

      {(state === "active" || state === "ended" || state === "adjudicated") && (
        <SessionRatingsCard reflections={reflections} />
      )}

      <MissReasonDialog
        challengeId={id}
        uid={uid}
        date={missTarget?.ymd ?? null}
        dateLabel={missTargetLabel(missTarget)}
        existing={missTarget ? reflectionsByDate.get(missTarget.ymd) : undefined}
        // Only a single day can be logged. A weekly window names a span, not
        // an occasion — "I did week 2" isn't a thing anyone did.
        onBackfill={
          missTarget?.kind === "day" &&
          canBackfill(
            challenge,
            missTarget.ymd,
            today,
            checkinYmds,
            member?.joinedDate,
            away
          )
            ? () => handleBackfill(missTarget.ymd)
            : undefined
        }
        // The mirror image: only a whole week can take a spare. Spares are
        // earned per week kept and spent per week missed, and a daily habit
        // can't earn one in the first place (see canEarnBadges).
        spare={spareOffer}
        onClose={() => setMissTarget(null)}
        onError={setError}
      />

      <ChallengeSettingsCard
        challenge={challenge}
        show={canSetAutoRepeat}
        nextCycleStart={nextCycleStart}
        nextCycleWeeks={nextCycleWeeks}
        togglingAutoRepeat={togglingAutoRepeat}
        togglingVisibility={togglingVisibility}
        onToggleAutoRepeat={handleToggleAutoRepeat}
        onToggleVisibility={handleToggleVisibility}
      />
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
