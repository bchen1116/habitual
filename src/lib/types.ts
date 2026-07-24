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
  maxMembers?: number | null; // group only, optional cap
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
  toCharityName: string | null;
  amount: number;
  status: LedgerStatus;
  settledAt: Timestamp | null;
  receiptURL: string | null;
  note: string | null;
  createdAt: Timestamp | null;
}
