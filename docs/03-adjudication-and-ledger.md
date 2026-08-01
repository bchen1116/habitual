# 03 — Adjudication & Ledger

**Goal:** add the Cloud Function that adjudicates ended challenges and creates ledger entries, plus the Ledger UI to view and settle debts.

## What ships

- **Cloud Function:** scheduled daily adjudication at 03:00 UTC
- Ledger entries created for failed solo challenges (charity mode)
- **Ledger overview** (`/ledger`) with tabs: I owe / I'm owed
- **Ledger entry detail** (`/ledger/[entryId]`)
- **Mark settled** action with optional receipt upload (drag-and-drop on desktop, native picker on mobile)
- **Dashboard ledger summary** card

## Data model

**`ledgerEntries/{entryId}`** (new, top-level for easy per-user queries)
```
challengeId: string
challengeName: string            # denormalized
fromUid: uid
fromName: string
toType: "charity" | "user"
toUid: uid | null
toName: string | null
toCharityName: string | null
amount: number
status: "unsettled" | "settled"
settledAt: timestamp | null
receiptURL: string | null        # Firebase Storage URL
note: string | null
createdAt: timestamp
```

**`challenges/{cid}/members/{uid}`** (updated)
```
outcome: "succeeded" | "failed"
completedCount: int
skipsUsed: int
adjudicatedAt: timestamp
```

**`challenges/{cid}`** (updated)
```
status: "active" | "cancelled" | "adjudicated"
adjudicatedAt: timestamp | null
```

## Backend

**Cloud Function `adjudicateEndedChallenges`:**
- Trigger: scheduled, every 24 hours at 03:00 UTC
- Logic:
  1. Query `challenges where status == "active" and endDate <= yyyymmdd(now − 39h)`. Dates are `yyyymmdd` strings, which sort chronologically, so this is a plain string comparison. The buffer matters: check-ins are keyed by **user-local** dates, so a challenge ending "July 22" isn't over everywhere until July 23 12:00 UTC (end of day in UTC−12). Grading at a bare `endDate < now` would mark members in lagging timezones as failed while their final day is still in progress. `endDate <= yyyymmdd(now − 39h)` first becomes true exactly at endDate + 39h — safe for every timezone, at the cost of results landing up to a day later. **39, not 36:** the habit day rolls over at 03:00 local (docs/02), so the last instant anyone can still log "July 22" is 02:59 on July 23 local — 14:59 UTC in UTC−12, three hours past what 36 allowed. At 36 the nightly run could grade a member while their day was still open and their stake still winnable. (Refinement for later: gate per-challenge on the max of members' actual local end-of-day instants.) Cancelled challenges are never picked up — the status filter excludes them.
  2. For each challenge, run adjudication **inside a Firestore transaction** so ledger entry creation + challenge status update are atomic (if the function dies mid-way, next run picks up cleanly)
  3. For each member:
     - Count check-ins with `localDate in [startDate, endDate]` (string range over the subcollection)
     - Compute missed count:
       - `daily`: `required = number of days in [startDate, endDate]`; `missed = required − completed`
       - `weekly_count`: split the challenge into sequential 7-day windows from `startDate` (durations are whole weeks — enforced at creation, step 2). Per window: `missed_w = max(0, required_w − checkinsInWindow)`; `missed = Σ missed_w`. Per-window accounting is what makes the pace real — 10 check-ins crammed into week one of a two-week 5×/week challenge still misses week two entirely.
       - `required_w` comes from `windowRequirement()`: `0` for windows that ended before the member joined, the full `target` for windows starting on or after they joined, and otherwise `min(daysAvailable, ceil(target × daysAvailable / 7))` for the one window they joined into. The `daysAvailable` cap is load-bearing — only one check-in can exist per member per day (`${localDate}_${uid}`), so without it someone joining a 5×/week habit on a Saturday would owe 5 check-ins across 2 days and forfeit their stake over a shortfall no effort could have prevented. `ceil` keeps it demanding and the result is never 0, so joining late buys no free week. The function is duplicated in `functions/src/adjudicate.ts` and `src/lib/progress.ts` (no shared package); they must agree — one decides the money, the other makes the promise the member sees.
     - `outcome = "succeeded" if missed <= skipDays else "failed"`
     - Write outcome, completedCount, skipsUsed, adjudicatedAt to member doc
  4. Create ledger entries (see below)
  5. Set `challenge.status = "adjudicated"`, `adjudicatedAt = now` — this runs for **every** processed challenge, including ones that produced zero ledger entries (all-succeeded, and later the all-fail pool wash in step 5)
- **Idempotency:** transaction reads `challenge.status`; skips if already `"adjudicated"`

**Ledger creation (solo + charity in this step):**
```
for failed_member in challenge.members:
  create ledger entry:
    fromUid    = member.uid
    fromName   = member.displayName
    toType     = "charity"
    toCharityName = member.charityName
    amount     = challenge.stakeAmount
    status     = "unsettled"
```

**Firestore rules:**
```
match /ledgerEntries/{entryId} {
  allow read: if request.auth.uid == resource.data.fromUid
              || request.auth.uid == resource.data.toUid;
  allow create: if false;                    # server only
  allow update: if request.auth.uid == resource.data.fromUid
                && request.resource.data.diff(resource.data).affectedKeys()
                     .hasOnly(["status", "settledAt", "receiptURL", "note"])
                # settling is one-way and can't be backdated:
                && request.resource.data.status == "settled"
                && (resource.data.status == "unsettled"
                      ? request.resource.data.settledAt == request.time
                      : request.resource.data.settledAt == resource.data.settledAt);
  allow delete: if false;
}
```

**Storage rules:**
```
match /receipts/{uid}/{entryId} {
  allow read: if request.auth.uid == uid
              || request.auth.uid == firestore.get(
                   /databases/(default)/documents/ledgerEntries/$(entryId)
                 ).data.toUid;
  allow write: if request.auth.uid == uid
               && request.resource.size < 5 * 1024 * 1024   # 5MB max
               && request.resource.contentType.matches('image/.*');
}
```

**Firestore indexes:**
- `ledgerEntries`: `(fromUid, status)`, `(toUid, status)` — single-field `challengeId` lookups are automatic
- `challenges`: `(status, endDate)` — the adjudication query

## Frontend

**Receipt upload:**
- Desktop: drag-and-drop into a dropzone (use `react-dropzone` or a small custom hook)
- Mobile: file input with `capture="environment"` for camera capture — `<input type="file" accept="image/*" capture="environment">`. Also allows picking from photo library.
- Upload directly to Firebase Storage via the Web SDK; write the resulting URL to the ledger entry doc.
- Show upload progress bar during upload.

**Ledger UI:**
- Two tabs implemented with a URL query param (`?tab=owe`) so the state is shareable/refreshable
- Grouped list: use `Object.groupBy` (or manual reduce) by counterparty
- Row action patterns per platform:
  - Mobile: swipe-to-reveal action (use `framer-motion` for drag gesture)
  - Desktop: hover reveals inline "Mark settled" button

## Screens

- **Dashboard ledger summary card** — added at top of `/dashboard`
- **Ledger overview** (`/ledger`) — tabs, filter, grouped list
- **Ledger entry detail** (`/ledger/[entryId]`) — full detail + settle
- **Settle sheet/modal** — confirm + optional receipt

## Non-goals

- Group ledger entries (step 4 uses same model — activates for groups)
- Pool mode ledger entries (step 5)
- Push on new debt (step 6)
- Receipt verification / OCR

## Manual test checklist

- [ ] Create a solo challenge with `endDate` in the past; no check-ins
- [ ] Trigger `adjudicateEndedChallenges` manually via Firebase console (or wait)
- [ ] Challenge flips to `adjudicated`; member outcome is `failed`
- [ ] Ledger entry appears under "I owe" with correct amount + charity
- [ ] Dashboard summary shows the total
- [ ] Click entry → detail → Mark settled → upload receipt via drag-and-drop (desktop) → status flips to Settled
- [ ] Repeat on mobile: use camera capture; upload works
- [ ] Complete a challenge (all check-ins done) → outcome `succeeded`, no ledger entry
- [ ] Re-run function on adjudicated challenge → no duplicate entries (transaction guard)
- [ ] Signed-out client cannot read any ledger entry
- [ ] Non-counterparty user cannot read entry
- [ ] Non-fromUid cannot upload receipt (Storage rule)

## Acceptance

- Adjudication is deterministic, idempotent, and transactional
- Ledger entries correct for failed solo challenges
- Receipt upload works on both desktop (drag-and-drop) and mobile (camera or library)
- Dashboard summary + ledger UI render cleanly across viewports
