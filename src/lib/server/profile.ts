import "server-only";

import { getAdminDb } from "@/lib/firebase/admin";
import {
  challengesForUser,
  computeStreaks,
  isPrivate,
  memoizedChainReader,
} from "@/lib/server/leaderboard";
import { yyyymmddUTC } from "@/lib/server/challenge-admin";
import { challengeState, totalRequired, type ChallengeState } from "@/lib/progress";
import { splitActiveChallenges } from "@/lib/cycles";
import type {
  Challenge,
  ChallengeMember,
  LeaderboardVisibility,
  MemberOutcome,
} from "@/lib/types";

/**
 * Another member's profile: who they are, what they're running, how it's
 * going.
 *
 * Server-side for the same reason the leaderboard is — `users/{uid}` is
 * owner-only in firestore.rules, so a browser cannot read another person's
 * profile document at all, and every challenge/member/checkin read is gated
 * on co-membership. Only the Admin SDK sees enough to assemble this, which
 * means the visibility rules below are the *entire* protection: there is no
 * second gate underneath catching a mistake here.
 *
 * Two rules govern what comes back:
 *
 * 1. **You must already know them.** A profile is only served to someone who
 *    shares, or has shared, a habit with its subject. Without that, signing
 *    in would turn every uid into a readable dossier, and uids are visible to
 *    co-members via `memberIds`. It also matches the only places you can
 *    click through from — the leaderboard and a group's member list — both of
 *    which are peers-only already.
 * 2. **Private habits stay private.** A habit marked `visibility: "private"`
 *    appears only if the viewer is in it too. That filter is applied *before*
 *    the streaks are computed, not just before they're rendered: a streak
 *    figure that silently counts a habit you can't see is the same leak with
 *    an extra step.
 */

export interface ProfileHabit {
  id: string;
  name: string;
  mode: "solo" | "group";
  state: ChallengeState;
  frequencyLabel: string;
  startDate: string;
  endDate: string;
  /** Their check-ins so far, against their own requirement. */
  completed: number;
  total: number;
  outcome: MemberOutcome;
  /** Whether the viewer is in this habit too. */
  shared: boolean;
  /** Only ever true when `shared` — a private habit you're not in isn't here at all. */
  isPrivate: boolean;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  username: string | null;
  photoURL: string | null;
  /** Epoch ms of their `users/{uid}.createdAt`, or null on docs predating it. */
  joinedAtMs: number | null;
  isSelf: boolean;
  /**
   * Null when they've set `leaderboardVisibility: "hidden"`. That flag is an
   * opt-out of having your streaks shown to other people; a profile page is
   * the same exposure by another route, so it's honoured here rather than
   * quietly worked around. Everything else about them still shows — they
   * don't disappear from a habit they're visibly in.
   */
  streaks: {
    currentStreak: number;
    currentStreakWeeks: number;
    longestStreak: number;
  } | null;
  active: ProfileHabit[];
  past: ProfileHabit[];
  /** Across the habits this viewer can see, so the arithmetic always adds up. */
  totals: {
    habitsFinished: number;
    habitsWon: number;
    checkIns: number;
  };
}

function frequencyLabel(challenge: Challenge): string {
  return challenge.frequency?.type === "weekly_count"
    ? `${challenge.frequency.target}× a week`
    : "Every day";
}

/**
 * Null when there's no such user, or when the viewer has no shared history
 * with them. Both cases are deliberately indistinguishable to the caller: a
 * "this person exists but you can't see them" response would confirm a uid is
 * real, which is exactly what the peer rule is there to withhold.
 */
export async function getUserProfile(
  viewerUid: string,
  targetUid: string
): Promise<UserProfile | null> {
  const db = getAdminDb();
  const today = yyyymmddUTC(new Date());

  const [userSnap, targetChallenges, viewerChallenges] = await Promise.all([
    db.collection("users").doc(targetUid).get(),
    challengesForUser(db, targetUid),
    viewerUid === targetUid
      ? Promise.resolve<Challenge[]>([])
      : challengesForUser(db, viewerUid),
  ]);

  const user = userSnap.data();
  if (!user) return null;

  const isSelf = viewerUid === targetUid;
  const viewerChallengeIds = new Set(
    (isSelf ? targetChallenges : viewerChallenges).map((c) => c.id)
  );
  const shareHistory = targetChallenges.some((c) => viewerChallengeIds.has(c.id));
  if (!isSelf && !shareHistory) return null;

  // The single filter everything else is derived from.
  const visible = targetChallenges.filter(
    (c) => !isPrivate(c) || viewerChallengeIds.has(c.id)
  );

  // One memo for the whole request, shared with computeStreaks below: the
  // member docs and check-in sets the habit list needs are exactly the ones
  // the streak engine reads, so between them each is fetched once.
  const reader = memoizedChainReader(db, targetChallenges);

  const hidden =
    (user.leaderboardVisibility as LeaderboardVisibility | undefined) === "hidden";

  // The habit list and the streaks are independent of each other, and the
  // habits resolve concurrently rather than one round trip per habit.
  const [streaks, habits] = await Promise.all([
    hidden && !isSelf
      ? Promise.resolve(null)
      : computeStreaks(db, targetUid, visible, today, reader),
    Promise.all(
      visible.map(async (challenge): Promise<ProfileHabit> => {
        const state = challengeState(challenge, today);
        const [memberSnap, checkinYmds] = await Promise.all([
          db
            .collection("challenges")
            .doc(challenge.id)
            .collection("members")
            .doc(targetUid)
            .get(),
          // Adjudicated challenges froze completedCount at grading time, so
          // their check-ins are never needed — but the memo means asking for
          // them costs nothing extra when the streak engine wants them anyway.
          state === "adjudicated"
            ? Promise.resolve<string[] | null>(null)
            : reader.getCheckinYmds(challenge.id, targetUid),
        ]);
        const member = memberSnap.data() as ChallengeMember | undefined;

        // Authoritative in a way a recount wouldn't be, if the rules ever
        // changed underneath an old result.
        const completed =
          checkinYmds === null && typeof member?.completedCount === "number"
            ? member.completedCount
            : (checkinYmds ?? (await reader.getCheckinYmds(challenge.id, targetUid)))
                .length;

        return {
          id: challenge.id,
          name: challenge.name,
          mode: challenge.mode,
          state,
          frequencyLabel: frequencyLabel(challenge),
          startDate: challenge.startDate,
          endDate: challenge.endDate,
          completed,
          total: totalRequired(challenge, member?.joinedDate),
          outcome: member?.outcome ?? null,
          shared: viewerChallengeIds.has(challenge.id),
          isPrivate: isPrivate(challenge),
        };
      })
    ),
  ]);

  const isFinished = (h: ProfileHabit) =>
    h.state === "adjudicated" || h.state === "cancelled" || h.state === "ended";

  // A repeating habit overlaps itself for a day — auto-repeat builds the next
  // cycle before the current one ends, because a gap would break the streak
  // (lib/cycles.ts). Both are open challenges, so without this the profile
  // would list "Morning run" twice as if they were two separate commitments.
  // Only the cycle that represents the habit right now is kept; the other is
  // suppressed rather than demoted to `past`, since an unstarted cycle is not
  // history either.
  const stillOpen = visible.filter((c) => {
    const s = challengeState(c, today);
    return s === "active" || s === "upcoming";
  });
  const representing = new Set(
    splitActiveChallenges(stillOpen, today).live.map((c) => c.id)
  );

  const active = habits
    .filter((h) => !isFinished(h) && representing.has(h.id))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = habits
    .filter(isFinished)
    .sort((a, b) => b.endDate.localeCompare(a.endDate));

  const createdAt = user.createdAt as { toMillis?: () => number } | undefined;

  return {
    uid: targetUid,
    displayName: (user.displayName as string | undefined) ?? "Someone",
    username: (user.username as string | undefined) ?? null,
    photoURL: (user.photoURL as string | undefined) ?? null,
    joinedAtMs: createdAt?.toMillis?.() ?? null,
    isSelf,
    streaks,
    active,
    past,
    totals: {
      habitsFinished: past.filter((h) => h.state === "adjudicated").length,
      habitsWon: past.filter((h) => h.outcome === "succeeded").length,
      checkIns: habits.reduce((sum, h) => sum + h.completed, 0),
    },
  };
}
