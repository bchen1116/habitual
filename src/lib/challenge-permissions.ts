import type { ChallengeState } from "@/lib/progress";
import type { Challenge } from "@/lib/types";

/**
 * What the viewer is allowed to do with a habit.
 *
 * Pure, and gathered in one place on purpose. These are the rules that decide
 * whether money terms can still change, and each one carries a reason that is
 * easy to lose track of when they're scattered through a render as six
 * separate `const`s between the state and the JSX. Read together they also
 * make their relationships visible — `canEdit` and `canRepeat` are mutually
 * exclusive, `canSetAutoRepeat` covers the window neither of them does.
 *
 * These mirror, and must not exceed, what firestore.rules and the server
 * admin functions actually permit. Anything here is a UI affordance: hiding a
 * button the server would refuse, not granting one it wouldn't.
 */
export interface ChallengePermissions {
  isCreator: boolean;
  /**
   * Soft cancel, which keeps a "Cancelled" record. Only meaningful for group
   * habits, where other members might be watching for one — a solo habit has
   * nobody to show the record to, and Delete supersedes it there.
   */
  canCancel: boolean;
  /**
   * Permanent delete. Same "terms are frozen once anyone else has joined"
   * gate as canEdit: a group habit is only fully deletable while the creator
   * is still its sole member, after which Cancel is the only way out. Solo has
   * no such restriction and — unlike canEdit — no status restriction either,
   * since it affects nobody but its creator whatever state it is in.
   */
  canDelete: boolean;
  /**
   * Change stake, duration or skip days. The same freeze rule the app applies
   * everywhere else (firestore.rules' `challenges/{cid}` update block): group
   * habits are editable pre-join only; solo has nobody else to protect, so it
   * stays editable for as long as it is running.
   */
  canEdit: boolean;
  /**
   * Start a new cycle. Mutually exclusive with canEdit — that one is
   * upcoming/active, this one is ended/adjudicated.
   */
  canRepeat: boolean;
  /**
   * Toggle auto-repeat, for as long as the habit is running and no longer:
   * the job that acts on the flag looks a day *ahead* of the end date, so once
   * a cycle has ended the flag has nothing left to do — which is exactly the
   * case canRepeat covers.
   */
  canSetAutoRepeat: boolean;
  /**
   * The join code, when there is any point offering it: a group habit that
   * hasn't ended, and either still open or being looked at by the one person
   * who can reopen it. The code itself rather than a boolean, so the caller
   * needs no non-null assertion to use it.
   */
  inviteCode: string | null;
}

export function challengePermissions(
  challenge: Challenge,
  uid: string,
  state: ChallengeState
): ChallengePermissions {
  const isCreator = challenge.createdBy === uid;
  const soleMember = challenge.mode === "solo" || challenge.memberIds.length === 1;

  return {
    isCreator,
    canCancel: isCreator && state === "upcoming" && challenge.mode === "group",
    canDelete: isCreator && soleMember,
    canEdit:
      isCreator && (state === "upcoming" || state === "active") && soleMember,
    canRepeat: isCreator && (state === "ended" || state === "adjudicated"),
    canSetAutoRepeat: isCreator && challenge.status === "active",
    inviteCode:
      challenge.mode === "group" &&
      challenge.joinCode &&
      (state === "upcoming" || state === "active") &&
      (!challenge.joinClosed || isCreator)
        ? challenge.joinCode
        : null,
  };
}
