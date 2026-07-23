# Habitual

A habit tracker that puts money at stake — but never actually moves the money. Users owe (a charity or a friend) when they fail; Habitual keeps score and lets people mark debts settled after paying off-app. Think Splitwise for accountability.

Built as a **mobile-first responsive web app** with a PWA install path. Works on any modern browser (mobile, tablet, desktop); installs as a home-screen app for a native-feel experience and to enable push notifications.

## Docs

Planning docs live in [`docs/`](./docs/):

- [**overview.md**](./docs/overview.md) — product overview and full screen inventory (start here, hand to a designer)
- [01-scaffolding-and-auth.md](./docs/01-scaffolding-and-auth.md) — Next.js + Firebase + Google/Apple sign-in
- [02-solo-challenges.md](./docs/02-solo-challenges.md) — solo challenge lifecycle
- [03-adjudication-and-ledger.md](./docs/03-adjudication-and-ledger.md) — adjudication Cloud Function + ledger UI
- [04-group-challenges.md](./docs/04-group-challenges.md) — group challenges via shareable URLs
- [05-pool-mode.md](./docs/05-pool-mode.md) — winner-pool forfeit
- [06-pwa-and-push.md](./docs/06-pwa-and-push.md) — PWA install + web push (where supported)
- [07-polish-and-launch-prep.md](./docs/07-polish-and-launch-prep.md) — polish, custom domain, SEO, legal

## Stack

- **Next.js 15** (App Router) + TypeScript
- **Tailwind CSS** + **shadcn/ui** + **Framer Motion**
- **Firebase** — Auth, Firestore, Storage, Cloud Functions, Cloud Messaging
- **Serwist** for PWA / service worker
- **Vercel** for hosting

No payment processor. No escrow. No KYC. No native app.
