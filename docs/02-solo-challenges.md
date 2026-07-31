# 02 — Solo Challenges

**Goal:** ship the full solo challenge lifecycle: create → check in daily → see progress. Local reminders are gone (was a native concept); push notifications land in step 6 and only for users who install the PWA.

## What ships

- **Create challenge** flow (multi-step, solo only)
- **Dashboard** shows active solo challenges with today's pending check-in
- **Challenge detail** with today's check-in button + history
- **Check-in flow** with optional note (bottom sheet on mobile, modal on desktop)
- **Firestore offline persistence** enabled — check-ins queue and sync when the network returns
- **Optimistic UI** — check-in button flips to "Checked in ✓" instantly and reverts on write failure

## Data model

**`challenges/{challengeId}`** (new)
```
name: string
description: string | null
createdBy: uid
mode: "solo"                     # only solo in this step
forfeitType: "charity"           # only charity in this step
charityName: string
frequency: {
  type: "daily" | "weekly_count"
  target: int                    # for weekly_count
}
skipDays: int
stakeAmount: number
startDate: "yyyymmdd"            # calendar date, inclusive; each member's days run in their own timezone
endDate: "yyyymmdd"              # calendar date, inclusive last day; sorts chronologically as a string
status: "active" | "cancelled"   # "adjudicated" added in step 3; cancel = creator only, before startDate
memberIds: [uid]                 # just [creatorUid] for solo
createdAt: timestamp
```

**`challenges/{cid}/members/{uid}`** (subcollection, new)
```
displayName: string              # snapshot at join
joinedAt: timestamp
charityName: string              # solo: same as challenge's
outcome: null                    # set at adjudication (step 3)
completedCount: 0
skipsUsed: 0
```

**`challenges/{cid}/checkins/{yyyymmdd_uid}`** (subcollection, new)

Doc ID enforces one check-in per user per day.
```
uid: string
localDate: "yyyymmdd"            # computed from user.timezone; matches the doc-ID prefix so rules can validate it with plain string concat
completedAt: timestamp
note: string | null
```

## Frequency + skip-days semantics

Clarifying because these matter for adjudication in step 3:

- **`daily`:** one check-in required per day. `skipDays` = number of missed days allowed across the whole challenge.
- **`weekly_count`:** the challenge is divided into **sequential 7-day windows** starting at `startDate`; each window requires `target` check-ins. `skipDays` = total missed check-ins allowed across the whole challenge (pooled across windows, not missed weeks). The create flow **enforces whole-week durations** (7, 14, … up to 364 days — see `src/lib/duration.ts`) for `weekly_count` — a partial final window would demand `target` check-ins in fewer than 7 days, which can be arithmetically impossible. The rule is applied to `daily` too, where it's harmless, rather than branching on frequency.

Sequential windows anchored to `startDate` (not calendar weeks) avoid timezone-sensitive week boundaries (Sun–Sat vs Mon–Sun etc.). They're also more forgiving than a true rolling-window constraint while still preventing someone from front-loading all their check-ins into week one.

The grid stays anchored to `startDate` for every member, including late joiners, but each member's **requirement per window** is resolved individually by `windowRequirement()` — windows that ended before they joined are waived, and the window they joined into is prorated to the days they actually had (see docs/03). Without that proration a mid-week joiner could owe more check-ins than there are days left, which is unsatisfiable at one check-in per day.

## Backend

**Firestore rules:**
```
// Helper: yyyymmdd integer for a timestamp (UTC). Rules can't do timezone
// math, so date checks that need user-local awareness use a ±1-day tolerance.
function dateInt(ts) {
  return ts.year() * 10000 + ts.month() * 100 + ts.day();
}

match /challenges/{cid} {
  allow create: if request.auth.uid == request.resource.data.createdBy;
  allow read: if request.auth.uid in resource.data.memberIds;
  // Creator may edit — or cancel (status → "cancelled") — only while active
  // and before the start date.
  allow update: if request.auth.uid == resource.data.createdBy
                && resource.data.status == "active"
                && dateInt(request.time) < int(resource.data.startDate);

  match /members/{uid} {
    allow read: if request.auth.uid in get(/databases/$(database)/documents/challenges/$(cid)).data.memberIds;
    allow write: if request.auth.uid == uid;   # solo: only self writes own member doc (replaced by server functions in step 4)
  }

  match /checkins/{checkinId} {                # NOT {cid} — must not shadow the outer challenge-ID binding
    allow read: if request.auth.uid in get(/databases/$(database)/documents/challenges/$(cid)).data.memberIds;
    // Anti-backfill: the doc ID must be "<localDate>_<uid>" for the caller,
    // completedAt must be the server's time, and localDate must be within
    // ±1 day of the server date (the tolerance covers every timezone).
    // Without these checks a client could hand-craft writes for past days
    // and erase misses — and money rides on this.
    allow create: if request.auth.uid == request.resource.data.uid
                  && checkinId == request.resource.data.localDate + '_' + request.auth.uid
                  && request.resource.data.completedAt == request.time
                  && int(request.resource.data.localDate) >= dateInt(request.time - duration.value(1, 'd'))
                  && int(request.resource.data.localDate) <= dateInt(request.time + duration.value(1, 'd'));
    allow update, delete: if false;            # check-ins immutable
  }
}
```

**Firestore indexes:**
- `challenges`: `(memberIds array-contains, status)` — the dashboard's "my active challenges" query
- No check-in indexes needed: adjudication and history read each challenge's `checkins` subcollection directly (check-in docs carry no `challengeId` field, so there's no collection-group query)

**No Cloud Functions in this step.**

## Frontend

**Forms:** `react-hook-form` + `zod` schemas for validation.

**Dates:** `date-fns` (lightweight; use user's locale). Use `date-fns-tz` for user-timezone-aware "today" calculations.

**Today's date for check-in:**
```ts
const today = formatInTimeZone(new Date(), user.timezone, 'yyyyMMdd')
```
This gives the user's local date consistently regardless of what timezone they're currently in, in the same `yyyymmdd` format used by the check-in doc ID (`${today}_${uid}`) and the `localDate` field.

**Offline persistence:**
```ts
// firebase/client.ts
import { enableIndexedDbPersistence } from 'firebase/firestore'
enableIndexedDbPersistence(db).catch(err => {
  // failed-precondition = multiple tabs open (OK, use in-memory)
  // unimplemented = browser doesn't support (OK, fall back)
})
```

**Optimistic check-in:**
- Immediately show "Checked in ✓" locally
- Kick off the write
- On success: no visible change (already updated)
- On failure: revert + toast error

## Screens

- **Dashboard** (`/dashboard`) — populated with active challenges (the ledger summary card arrives in step 3, once the ledger exists)
- **Create challenge** (`/challenges/new`) — multi-step form (see `overview.md`)
- **Challenge detail** (`/challenges/[id]`) — solo variant: progress, check-in button, history
- **Check-in confirmation** — bottom sheet (mobile) / modal (desktop) with optional note

## Reminders — where they went

No local reminders. Local notifications require a native runtime or an installed PWA with background alarms — neither is reliable on the web (especially iOS). Reminders come in step 6 as **web push** for users who install the PWA and grant notification permission.

For users who don't install: they just need to open the site. Empty dashboard makes the daily check-in obvious.

## Non-goals

- Group challenges (step 4)
- Adjudication / ledger creation (step 3)
- Photo evidence
- Push notifications (step 6)
- Retroactive check-ins (only day-of, per the timezone-aware `today`)

## Manual test checklist

- [ ] Create a daily solo challenge (7 days, $10, "Red Cross") from mobile browser
- [ ] Challenge appears on dashboard
- [ ] Click challenge → detail with 0/7 progress
- [ ] Click "Check in for today" → count goes to 1/7, button state changes
- [ ] Try to check in again same day → button disabled or shows "Already checked in today"
- [ ] Simulate next day (change device clock or manually update `localDate`) → new check-in allowed
- [ ] Create a `weekly_count` challenge (5x/week, 4 weeks) → history reflects
- [ ] Offline test: go offline, check in → shows Checked in ✓, comes back online → write goes through
- [ ] Optimistic revert: force a permissions failure → button reverts + error toast
- [ ] Desktop: challenge detail renders in a wider layout (sidebar or centered card, per design)
- [ ] Dark mode across all screens

## Acceptance

- Can create a solo challenge end-to-end from any device
- One check-in per user per day, enforced by doc ID
- Offline check-in works; syncs on reconnect
- No local reminders; users open the site to check in
- Everything responsive across mobile / tablet / desktop
