import type { Timestamp } from "firebase/firestore";

export type FrequencyType = "daily" | "weekly_count";
export type ChallengeStatus = "active" | "cancelled" | "adjudicated";

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
