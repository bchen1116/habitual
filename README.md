# Habitual

A habit tracker that puts money at stake — but never actually moves the money. Users owe (a charity or a friend) when they fail; Habitual keeps score and lets people mark debts settled after paying off-app. Think Splitwise for accountability.

## Docs

Planning docs live in [`docs/`](./docs/):

- [**overview.md**](./docs/overview.md) — product overview and full screen inventory (start here, hand to a designer)
- [01-scaffolding-and-auth.md](./docs/01-scaffolding-and-auth.md) — Flutter + Firebase + Google/Apple sign-in
- [02-solo-challenges-and-reminders.md](./docs/02-solo-challenges-and-reminders.md) — solo challenge lifecycle + local reminders
- [03-adjudication-and-ledger.md](./docs/03-adjudication-and-ledger.md) — Cloud Function adjudication + ledger UI
- [04-group-challenges.md](./docs/04-group-challenges.md) — group challenges with charity forfeit
- [05-pool-mode.md](./docs/05-pool-mode.md) — winner-pool forfeit mode
- [06-push-notifications.md](./docs/06-push-notifications.md) — FCM push + notification settings
- [07-polish-and-launch-prep.md](./docs/07-polish-and-launch-prep.md) — polish, settings, store readiness

## Stack

- **Flutter** — iOS + Android
- **Firebase** — Auth, Firestore, Storage, Cloud Functions, Cloud Messaging
- No payment processor. No escrow. No KYC.
