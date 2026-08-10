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

/**
 * users/{uid}.awayRanges — dates the user declared off, in advance.
 *
 * On the user rather than on each habit because a holiday is one fact about a
 * person, not one per habit they're in: re-entering the same fortnight on
 * eight habits is a chore nobody does, and half-entering it is worse than not
 * offering it. Each habit then honours what it can afford (see lib/away.ts).
 *
 * Server-written only, like `username` — the value of a range depends on when
 * it was declared, and rules can't compare an array element against the
 * user's own local date.
 */
export interface AwayRange {
  /** yyyymmdd, inclusive. Always strictly after the day it was declared. */
  start: string;
  /** yyyymmdd, inclusive. */
  end: string;
  /** Optional, purely for the user's own recall — "Japan", "surgery". */
  label?: string | null;
}

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
   * The next cycle, once one exists — set by both the Repeat button and the
   * auto-repeat job. The reverse of `repeatedFromId`, and it earns its keep
   * three ways: adjudication follows it to push this cycle's graded badge
   * total onto the successor, the auto-repeat job reads it as "a successor
   * already exists" (so repeating by hand can't be followed by the job adding
   * a second one), and that same read is its idempotency guard. A document id
   * rather than a boolean because a "done" flag would prove a successor was
   * made but not which one, leaving no way to check the link is still intact.
   */
  repeatedToId?: string | null;
  /**
   * Weeks this habit already ran, across every earlier cycle in the chain, so
   * the second cycle of a weekly habit calls itself week 2 instead of week 1
   * again. Missing means 0 — a chain's first cycle, and every habit created
   * before this field existed.
   *
   * Stored rather than derived, unlike the streak or the badge count. Working
   * it out needs the length of every ancestor, and Today renders a week strip
   * per habit: deriving it would mean a read per cycle per habit on every
   * load, to compute a label. It also can't drift the way a derived-money
   * number could — it's fixed when the cycle is created, and the dates it
   * counts are fixed by then too (editChallengeAdmin refuses to move an end
   * date once a successor exists, which is the one thing that could have
   * stranded it).
   */
  weeksBefore?: number | null;
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
  /**
   * Set when the day was logged after the fact rather than on the day (see
   * lib/backfill.ts). Absent means logged live, which is every check-in
   * written before backfilling existed.
   *
   * Recorded rather than inferred, and kept even though nothing currently
   * branches on it, because this is the one field that distinguishes "did it
   * and tapped the button" from "said so later" — and check-ins decide who
   * forfeits a stake. Without it, the honour-system escape hatch would be
   * indistinguishable from the real thing in the only record that exists, and
   * a decision to stop counting backfills toward money could never be applied
   * retroactively.
   */
  backfilledAt?: Timestamp | null;
}

/**
 * One of the viewer's own check-ins, flattened for the UI.
 *
 * `completedAtMs` rather than a Timestamp because this shape crosses the
 * server/client boundary: a server component reads it with the Admin SDK and
 * hands it to a client component as a prop, and a Firestore Timestamp is a
 * class instance that React cannot serialise. A number survives the trip and
 * is what the one consumer (the check-in time on a completed habit row) wanted
 * anyway.
 */
export interface CheckinRecord {
  localDate: string;
  completedAtMs: number | null;
}

/**
 * Everything Today and the habits list need about the viewer's live habits,
 * in one payload — the same shape whether it came from the server on first
 * render or from the client's own listeners afterwards, so one can seed the
 * other without translation.
 */
export interface ActivitySnapshot {
  challenges: Challenge[];
  checkinsByChallenge: Record<string, CheckinRecord[]>;
  joinedDateByChallenge: Record<string, string | undefined>;
  /** users/{uid}.timezone, so the first render already knows what "today" is. */
  timezone: string | null;
  /**
   * users/{uid}.awayRanges, for the same reason: without it the first paint
   * would show days as missed that the very next render marks skipped.
   */
  awayRanges: AwayRange[];
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
 * - *Revisable.* Check-ins are immutable (`allow update, delete: if false`):
 *   a missed day can be logged late, but a recorded one can never be erased
 *   or rewritten. A rating carries no such risk, and a mistyped one you could
 *   never correct would be a trap.
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
   * The **unspent** spare-skip balance this cycle opened with: everything
   * earned in earlier cycles of this habit, less everything actually spent
   * there (see lib/badges.ts). Rolled forward by repeatChallengeAdmin and by
   * the auto-repeat job, then corrected by adjudication once the final week is
   * graded. Absent on members predating badges; treat as 0.
   *
   * It used to be the *gross* running total, because nothing ever consumed a
   * badge — they raised the allowance automatically and were carried forward
   * whole regardless. Now that spares are spent deliberately, "banked" has to
   * mean "still yours". Old values need no migration: with nothing ever
   * deducted, every stored total already was the unspent balance.
   */
  badgesCarried?: number;
  /** Badges earned in this cycle, frozen at adjudication. */
  badgesEarned?: number;
  /**
   * skipDays + spares applied to this cycle, frozen at adjudication so a
   * result stays explainable.
   */
  skipsAllowed?: number;
  /** Spares this cycle actually consumed, frozen at adjudication. */
  badgesSpent?: number;
}

/**
 * challenges/{cid}/spares/{windowStart}_{uid} — spare skips the member has
 * deliberately committed to one missed week of this cycle.
 *
 * Spares are *earned* by keeping a whole week (lib/badges.ts) and they follow
 * the habit across repeats, but they are no longer spent on the member's
 * behalf. Nothing here is written by the client: the balance a spare is drawn
 * against spans the whole repeat chain, and security rules cannot aggregate,
 * so every application goes through the server (lib/server/spares-admin.ts).
 *
 * Keyed on the window it covers rather than being a bare counter, because a
 * spare that names the week it saved can be shown in the history, taken back
 * while the cycle is still running, and bounded by that week's actual
 * shortfall — a counter could be none of those things.
 */
export interface SpareApplication {
  uid: string;
  /** yyyymmdd — the first day of the 7-day window this covers. */
  windowStart: string;
  /** Spares committed to this window; at least 1, never above its shortfall. */
  count: number;
  appliedAt: Timestamp | null;
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
