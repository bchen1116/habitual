import type { Timestamp } from "firebase/firestore";

export type FrequencyType = "daily" | "weekly_count";
export type ChallengeStatus = "active" | "cancelled" | "adjudicated";

/**
 * users/{uid}.leaderboardVisibility — who may see you ranked.
 * "friends": people you've shared a habit with (the default; absent means
 * this). "hidden": nobody but you. Deliberately a string rather than a
 * boolean so a wider "public" tier can be added without a data migration.
 */
export type LeaderboardVisibility = "friends" | "hidden";

export interface Challenge {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  mode: "solo" | "group";
  forfeitType: "charity" | "pool"; // pool: group only
  charityName: string | null; // creator's charity (null in pool mode); group members pick their own on join
  joinCode?: string | null; // group only
  joinPolicy?: "open" | "invite" | null; // group only; missing/null means "open"
  joinClosed?: boolean | null; // group only; creator-toggled, not date-driven — see docs on joinChallengeAdmin
  /**
   * Whether this habit counts toward its members' public leaderboard streak.
   * Missing/null means "public" — so every habit created before this field
   * existed keeps counting, which is the intended default. A "private" habit
   * still contributes to the streak shown to anyone who is *also* a member of
   * it (see getLeaderboard in lib/server/leaderboard.ts); it's hidden only
   * from people outside it.
   */
  visibility?: "public" | "private" | null;
  maxMembers?: number | null; // group only, optional cap
  streakResetAt?: string | null; // yyyymmdd; set when an edit increases skipDays
  repeatedFromId?: string | null; // id of the previous cycle (repeatChallengeAdmin); unset for a chain's first cycle
  /**
   * Keep going: when this cycle is nearly over, create the next one
   * automatically with the same terms, and set this flag on that one too, so
   * the habit rolls on until it's turned off. Missing/null means off — Repeat
   * stays a manual button for every habit created before this existed.
   */
  autoRepeat?: boolean | null;
  /**
   * The successor auto-repeat already created, if any. Doubles as the
   * idempotency guard for the Cloud Function that writes it, which is why it
   * is a document id rather than a boolean — a "done" flag would prove a
   * successor was made but not which one, and there'd be no way to check the
   * link is still intact.
   */
  autoRepeatedToId?: string | null;
  frequency: {
    type: FrequencyType;
    target: number; // check-ins per 7-day window; meaningful for weekly_count
  };
  skipDays: number;
  stakeAmount: number;
  startDate: string; // yyyymmdd, inclusive
  endDate: string; // yyyymmdd, inclusive
  status: ChallengeStatus;
  memberIds: string[];
  createdAt: Timestamp | null;
}

export interface CheckIn {
  uid: string;
  localDate: string; // yyyymmdd
  completedAt: Timestamp | null;
  note: string | null;
}

/**
 * Why a session was missed. Stored as a stable key, never the label — the
 * wording in MISS_REASONS (lib/reflections.ts) can be rewritten without
 * invalidating everything already recorded.
 */
export type MissReason =
  | "no_time"
  | "too_ambitious"
  | "wrong_time"
  | "travel"
  | "unwell"
  | "forgot"
  | "lost_motivation"
  | "other";

/**
 * challenges/{cid}/reflections/{localDate}_{uid} — one per member per day:
 * how the session went (1–10), or what got in the way when it was missed.
 *
 * Deliberately its own subcollection rather than extra fields on the check-in
 * doc, for two reasons the check-in doc can't satisfy:
 *
 * - *Private.* Check-ins are readable by every member of the challenge
 *   (firestore.rules). How a session felt, and why one was missed, is nobody
 *   else's business — group-visible ratings would be performed rather than
 *   honest, and "I was too depressed to run" is not a group broadcast.
 * - *Revisable.* Check-ins are immutable (`allow update, delete: if false`) so
 *   nobody can backfill a missed day. A rating carries no such risk, and a
 *   mistyped one you could never correct would be a trap.
 *
 * Nothing here is read by adjudication, streaks, or the leaderboard, and that
 * is a design rule rather than an accident: the moment a self-reported number
 * moves money or rank, it stops being honest.
 *
 * Every field is optional on the wire — writes merge, so a day can hold a
 * rating, a miss reason, or (across a repeat cycle where a date is reused)
 * both.
 */
export interface Reflection {
  uid: string;
  localDate: string; // yyyymmdd — the day, or the start of a weekly window
  rating?: number | null; // 1–10, how the session went
  missReason?: MissReason | null;
  missNote?: string | null;
  updatedAt?: Timestamp | null;
}

export type MemberOutcome = "succeeded" | "failed" | null;

export interface ChallengeMember {
  displayName: string;
  username: string | null; // snapshot at join/create time; disambiguates same-named members
  charityName: string | null; // null in pool mode
  outcome: MemberOutcome;
  completedCount: number;
  skipsUsed: number;
  /**
   * yyyymmdd; the creator's is always the challenge's own startDate, but a
   * member who joins after start gets today's date instead — their personal
   * "days required" window starts here, not at the challenge's official
   * start, so joining late doesn't retroactively count days they weren't a
   * member yet as missed (see effectiveStart in lib/progress.ts). Absent on
   * members created before this field existed; treat as == startDate.
   */
  joinedDate?: string;
  /**
   * Spare skips earned by completing whole weeks, banked against this habit
   * (see lib/badges.ts). Rolled forward by repeatChallengeAdmin so they can be
   * spent in a later cycle of the same habit, never another one. Absent on
   * members predating badges; treat as 0.
   */
  badgesCarried?: number;
  /** Badges earned in this cycle, frozen at adjudication. */
  badgesEarned?: number;
  /** skipDays + badges, frozen at adjudication so a result stays explainable. */
  skipsAllowed?: number;
}

/** challenges/{cid}/joinRequests/{uid} — pending approval on an invite-only group. */
export interface JoinRequest {
  displayName: string;
  username: string | null;
  charityName: string | null;
}

export type LedgerStatus = "unsettled" | "settled";

export interface LedgerEntry {
  id: string;
  challengeId: string;
  challengeName: string;
  fromUid: string;
  fromName: string;
  fromUsername: string | null;
  toType: "charity" | "user";
  toUid: string | null;
  toName: string | null;
  toUsername: string | null;
  /**
   * Only ever set on pool-mode (toType "user") entries — a charity has no
   * Venmo handle. Copied from the winner's users/{uid}.venmoUsername at
   * adjudication time (functions/src/adjudicate.ts), so it reflects
   * whatever handle they had when the debt was created; server-written
   * only and frozen afterward (ledgerEntries' update rule allow-list).
   */
  toVenmoUsername?: string | null;
  toCharityName: string | null;
  amount: number;
  status: LedgerStatus;
  settledAt: Timestamp | null;
  receiptURL: string | null;
  note: string | null;
  createdAt: Timestamp | null;
}
