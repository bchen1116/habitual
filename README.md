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

## Getting started

1. Complete the Firebase / Apple / Vercel console setup in [docs/01-scaffolding-and-auth.md](./docs/01-scaffolding-and-auth.md) (§ "What the user does").
2. Copy `.env.example` to `.env.local` and fill in the Firebase web config + service account key.
3. Deploy `firestore.rules` to your Firebase project (Firebase console → Firestore → Rules, or `firebase deploy --only firestore:rules`).
4. Install and run:

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`. Sign-in requires the Firebase Auth providers (Google, Apple) to be enabled and `localhost` present in Firebase Auth's authorized domains (it is by default).

## Launch checklist

1. **Firebase**: project created, Google + Apple auth enabled, Firestore + Storage enabled, Blaze plan, Web Push certificate generated (`NEXT_PUBLIC_FIREBASE_VAPID_KEY`).
2. **Deploy backend**: `firebase deploy` (rules, indexes, functions — all wired in `firebase.json`).
3. **Vercel**: repo imported, all env vars from `.env.example` set, deployed.
4. **Custom domain**: buy → add in Vercel → DNS per Vercel's instructions → add the domain to Firebase Auth authorized domains → set `NEXT_PUBLIC_APP_URL`.
5. **Legal**: `/terms` and `/privacy` ship with reasonable defaults — have a lawyer review before public launch (money-adjacent apps attract disputes even without payment processing).
6. **Icons/branding**: current icons are generated placeholders — replace via `scripts/generate-icons.mjs` once real branding exists.
7. **Analytics** (optional, deferred): Plausible needs no cookie banner; PostHog does. Not yet wired.
