# 03 — Adjudication & Ledger

**Goal:** add the Cloud Function that adjudicates ended challenges and creates ledger entries, plus the Ledger UI to view and settle debts.

## What ships

- **Cloud Function:** scheduled adjudication (runs daily at 03:00 UTC)
- Ledger entries created for failed solo challenges (charity mode)
- **Ledger overview** screen (two tabs: I owe / I'm owed)
- **Ledger entry detail** screen
- **Mark settled** action with optional receipt upload
- **Home dashboard** ledger summary card

## Data model

**`ledgerEntries/{entryId}`** (new, top-level for easy per-user queries)
```
challengeId: string
challengeName: string            # denormalized for display
fromUid: uid
fromName: string                 # denormalized
toType: "charity" | "user"
toUid: uid | null                # set if toType == "user"
toName: string | null            # denormalized user display name
toCharityName: string | null     # set if toType == "charity"
amount: number
status: "unsettled" | "settled"
settledAt: timestamp | null
receiptURL: string | null        # Cloud Storage URL
note: string | null              # from settlement flow
createdAt: timestamp
```

**`challenges/{cid}/members/{uid}`** (updated)
```
# Existing fields plus:
outcome: "succeeded" | "failed"  # set at adjudication
completedCount: int
skipsUsed: int
adjudicatedAt: timestamp
```

**`challenges/{cid}`** (updated)
```
status: "active" | "adjudicated"   # new state
adjudicatedAt: timestamp | null
```

## Backend

**Cloud Function (`adjudicateEndedChallenges`):**
- Trigger: scheduled, every 24 hours at 03:00 UTC
- Logic:
  1. Query `challenges where status == "active" and endDate < now`
  2. For each challenge:
     - For each member (subcollection):
       - Count check-ins with `localDate in [startDate, endDate]`
       - Compute required count based on `frequency` (daily = days between; weekly_count = target × weeks)
       - `missed = required - completed`
       - `if missed <= challenge.skipDays: outcome = "succeeded"`
       - `else: outcome = "failed"`
       - Write outcome, completedCount, skipsUsed, adjudicatedAt to member doc
     - **Create ledger entries** (see below)
     - Set `challenge.status = "adjudicated"`, `adjudicatedAt = now`
  3. Idempotent: skip challenges already marked "adjudicated"

**Ledger creation (this step: solo charity only):**
- For each failed member: create one entry
  ```
  fromUid: member.uid
  fromName: member.displayName
  toType: "charity"
  toCharityName: member.charityName
  amount: challenge.stakeAmount
  status: "unsettled"
  ```

**Firestore rules:**
```
match /ledgerEntries/{entryId} {
  allow read: if request.auth.uid == resource.data.fromUid
              || request.auth.uid == resource.data.toUid;
  allow create: if false;                    # server only
  allow update: if request.auth.uid == resource.data.fromUid
                && request.resource.data.diff(resource.data).affectedKeys()
                     .hasOnly(["status", "settledAt", "receiptURL", "note"]);
  allow delete: if false;
}
```

**Storage rules (Cloud Storage):**
```
match /receipts/{uid}/{entryId} {
  allow read: if request.auth.uid == uid
              || request.auth.uid == firestore.get(/databases/(default)/documents/ledgerEntries/$(entryId)).data.toUid;
  allow write: if request.auth.uid == uid;
}
```

**Firestore indexes:**
- `ledgerEntries`: `(fromUid, status)`, `(toUid, status)`, `(challengeId)`

## Flutter dependencies (new)

```yaml
firebase_storage
image_picker
```

## Screens

- **Home ledger summary card** — added to top of dashboard
- **Ledger overview** — tabs (I owe / I'm owed), filters, grouped list
- **Ledger entry detail** — full info + settle action
- **Settle sheet** — confirm + optional receipt upload

## Non-goals

- Group ledger entries (step 4 uses same data model but activates for groups)
- Pool mode ledger entries (step 5)
- Push notifications on new debt (step 6)
- Auto-detection of receipts / OCR

## Manual test checklist

- [ ] Create a solo challenge with `endDate = today`, skip all check-ins
- [ ] Wait for scheduled function OR trigger `adjudicateEndedChallenges` manually via Firebase console
- [ ] Challenge status flips to "adjudicated"; member outcome is "failed"
- [ ] Ledger entry appears under "I owe", amount matches stake, counterparty matches charity
- [ ] Home dashboard summary card shows "$10 owed"
- [ ] Tap entry → detail → tap Mark settled → upload receipt → status shows "Settled"
- [ ] Receipt image appears in entry detail after upload
- [ ] Create + complete a challenge (all check-ins done) → outcome "succeeded", no ledger entry
- [ ] Re-run function on already-adjudicated challenge → no duplicate entries
- [ ] Signed-out user cannot read any ledger entry (Firestore rule)
- [ ] User cannot read someone else's ledger entry (rule)

## Acceptance

- Adjudication runs on schedule and produces correct outcomes
- Ledger entries created for failed solo challenges
- Users can view, settle, and upload receipts for their debts
- Home dashboard reflects total owed
