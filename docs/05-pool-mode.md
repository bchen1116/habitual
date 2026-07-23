# 05 — Pool Mode

**Goal:** add the winner-pool forfeit mode for group challenges. Failers' stakes split among succeeders as user-to-user ledger entries. Also handle the all-fail edge case.

## What ships

- Create challenge flow gains a **Forfeit type** step (Charity / Pool), shown only after Mode = Group
- Adjudication extended to handle pool mode
- Ledger UI shows user-to-user entries (avatars, names) alongside charity entries
- Home dashboard ledger summary distinguishes people-debts from charity-debts
- All-fail pool challenges: **no ledger entries created** (per spec — treat as a wash)
- All-fail charity challenges: every member owes their stake to their charity (already the behavior from step 4)

## Data model changes

**`challenges/{cid}`** (updated)
```
forfeitType: "charity" | "pool"
```

**`ledgerEntries`** — no schema changes needed. `toType: "user"` was already supported in the model; now activated for real.

## Backend

**Adjudication updates:**
```
if challenge.forfeitType == "pool":
  winners = members.filter(outcome == "succeeded")
  losers  = members.filter(outcome == "failed")
  if len(winners) == 0:
    # wash — everyone loses face, nobody owes
    pass
  else:
    perWinnerShare = challenge.stakeAmount / len(winners)
    for loser in losers:
      for winner in winners:
        create ledger entry:
          fromUid = loser.uid, fromName = loser.displayName
          toType = "user"
          toUid = winner.uid, toName = winner.displayName
          amount = perWinnerShare   # stored as float
          status = "unsettled"
elif challenge.forfeitType == "charity":
  # unchanged from step 4
```

**Rounding:** store as float; display rounded to $0.01. Small imbalances between "sum of debts owed" and "sum of credits owed to me" are OK (informal — friends handle it).

**Firestore rules:** no changes. `toUid` is already a permitted reader per step 3's rules.

**Firestore indexes:** already covered by step 3's `(fromUid, status)` and `(toUid, status)`.

## Screens

- **Create challenge** — Forfeit type step added between Mode and Charity name. If Pool selected, skip the charity input step entirely.
- **Challenge detail (group)** — badge for forfeit type ("Charity forfeit" or "Winner pool")
- **Ledger overview** — user-to-user entries render with avatar + name; charity entries render with charity name (unchanged from step 3)
- **Home dashboard** — summary card can distinguish: "You owe **$47** ($30 to people, $17 to charities)"

## Non-goals

- Handling members leaving pool challenges (challenges lock once active — this stays)
- Cross-currency debts
- Automatic settlement between mutual debts (i.e., netting)

## Manual test checklist

- [ ] Create group pool challenge with 4 members, $10 each
- [ ] 2 members succeed, 2 fail → 4 ledger entries total (2 losers × 2 winners), each $5
- [ ] Each winner sees $10 total credit under "I'm owed" (2 entries × $5 from the 2 losers)
- [ ] Each loser sees $10 total debt under "I owe" (2 entries × $5 to the 2 winners)
- [ ] All 4 members fail → no ledger entries (wash)
- [ ] All 4 members succeed → no ledger entries
- [ ] 1 winner, 3 losers → 3 entries, each $10 to the sole winner (winner receives $30 total)
- [ ] Sum of all "I owe" amounts equals sum of all "I'm owed" amounts within the challenge (informal integrity check)
- [ ] Ledger UI renders user avatars correctly

## Acceptance

- Pool mode selectable for group challenges
- Pool math correct across various win/lose distributions
- All-fail pool = no ledger entries; UI reflects "everyone missed — no debts owed"
- Ledger correctly distinguishes user-to-user vs user-to-charity entries
