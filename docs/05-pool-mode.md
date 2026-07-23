# 05 — Pool Mode

**Goal:** add the winner-pool forfeit mode for group challenges. Failers' stakes split among succeeders as user-to-user ledger entries. Handle the all-fail edge case.

Server-side logic mostly; frontend just needs to render the new forfeit type option + user-to-user ledger entries.

## What ships

- Create flow gains a **Forfeit type** step (Charity / Pool), shown only after Mode = Group
- Adjudication extended to handle pool mode
- Ledger UI shows user-to-user entries (avatars, names) alongside charity entries
- Dashboard summary can distinguish debts to people vs debts to charities
- All-fail pool challenges: **no ledger entries created** (per spec — treat as a wash)
- All-fail charity challenges: every member owes their stake to their charity (already works from step 4)

## Data model changes

**`challenges/{cid}`** (updated)
```
forfeitType: "charity" | "pool"
```

**`ledgerEntries`** — no schema changes. `toType: "user"` was already supported; activated for real in this step.

## Backend

**Adjudication updates (in the transaction):**
```
if challenge.forfeitType == "pool":
  winners = members.filter(outcome == "succeeded")
  losers  = members.filter(outcome == "failed")
  if winners.length > 0:
    perWinnerShare = challenge.stakeAmount / winners.length
    for loser in losers:
      for winner in winners:
        create ledger entry:
          fromUid = loser.uid,   fromName = loser.displayName
          toType  = "user"
          toUid   = winner.uid,  toName  = winner.displayName
          amount  = perWinnerShare       # stored as number
          status  = "unsettled"
  # winners.length == 0 → wash: create NO ledger entries, but do NOT return
  # early — execution must fall through to step 3's final step so the
  # challenge is still marked "adjudicated". An early return here would
  # leave it "active" and re-processed by every future run, forever.
elif challenge.forfeitType == "charity":
  # unchanged from step 4
```

**Rounding:** amounts stored as JS `number`; display rounded to $0.01. Small imbalances (e.g., $10 / 3 = $3.33 × 3 = $9.99, one cent short) are OK — friends handle it.

**Firestore rules:** no changes.
**Firestore indexes:** already covered.

## Frontend

- **Create flow:** Forfeit type step added between Mode and Charity name. If Pool selected, skip the charity input step entirely.
- **Challenge detail (group):** badge for forfeit type ("Charity forfeit" or "Winner pool")
- **Ledger overview:** user-to-user entries render with avatar + display name; charity entries render with charity name (from step 3)
- **Dashboard summary:** can split — "You owe **$47** ($30 to people, $17 to charities)"
- **User avatars:** grab from `photoURL` on user doc; fallback to initials in a colored circle

## Non-goals

- Handling members leaving pool challenges (challenges stay locked once active)
- Cross-currency debts
- Automatic netting of mutual debts

## Manual test checklist

- [ ] Create group pool challenge with 4 members, $10 each
- [ ] 2 succeed, 2 fail → 4 ledger entries (2 losers × 2 winners), each $5
- [ ] Each winner sees $10 total credit ("I'm owed" tab)
- [ ] Each loser sees $10 total debt ("I owe" tab)
- [ ] All 4 fail → no ledger entries (wash)
- [ ] All 4 succeed → no ledger entries
- [ ] 1 winner, 3 losers → 3 entries × $10 to the sole winner (winner receives $30 total)
- [ ] $10 stake, 3 winners → each entry is $3.33; total forfeit = $9.99 (off by a cent, OK)
- [ ] Ledger UI: user-to-user entries render with avatar/name; charity entries with charity name
- [ ] Dashboard summary splits "to people" vs "to charities"

## Acceptance

- Pool mode selectable for group challenges
- Pool math correct across various win/lose distributions
- All-fail pool = no ledger entries; UI reflects "everyone missed — no debts owed"
- Ledger distinguishes user-to-user vs user-to-charity entries visually
