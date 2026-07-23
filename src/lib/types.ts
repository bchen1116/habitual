import type { Timestamp } from "firebase/firestore";

export type FrequencyType = "daily" | "weekly_count";
export type ChallengeStatus = "active" | "cancelled" | "adjudicated";

export interface Challenge {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  mode: "solo";
  forfeitType: "charity";
  charityName: string;
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
  charityName: string;
  outcome: MemberOutcome;
  completedCount: number;
  skipsUsed: number;
}

export type LedgerStatus = "unsettled" | "settled";

export interface LedgerEntry {
  id: string;
  challengeId: string;
  challengeName: string;
  fromUid: string;
  fromName: string;
  toType: "charity" | "user";
  toUid: string | null;
  toName: string | null;
  toCharityName: string | null;
  amount: number;
  status: LedgerStatus;
  settledAt: Timestamp | null;
  receiptURL: string | null;
  note: string | null;
  createdAt: Timestamp | null;
}
