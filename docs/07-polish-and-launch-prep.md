# 07 — Polish & Launch Prep

**Goal:** empty states, error handling, loading polish, settings, custom domain, analytics, legal pages — everything to make the site feel finished and go live at a real URL.

## What ships

- **Empty states** for all list screens
- **Loading skeletons** instead of raw spinners
- **Error handling:** network failures, permission errors, Cloud Function errors — all surface with clear human copy
- **Toast pattern** (via `sonner` or shadcn/ui's toast) for transient feedback
- **Confirmation dialogs** for destructive actions (cancel challenge, mark settled, sign out, delete account)
- **Profile screen** (edit display name, avatar upload)
- **Settings** — notifications, about, delete account
- **Page transitions** via Framer Motion (subtle, respects `prefers-reduced-motion`)
- **Custom domain** on Vercel (e.g., `habitual.app`)
- **SEO basics** — meta tags, OG image, `sitemap.xml`, `robots.txt`
- **Analytics** — Plausible or PostHog
- **Legal pages** — `/terms`, `/privacy`
- **Cookie consent** if using analytics that sets cookies (PostHog does; Plausible doesn't)
- **Favicons and app icons** at all required sizes

## Data model changes

**`users/{uid}`** (updated)
```
deletedAt: timestamp | null       # soft-delete marker
```

## Backend

**Callable Cloud Function `deleteAccount`:**
- Verify caller uid == target
- Cascade:
  - Cancel any active solo challenges (mark abandoned)
  - Remove user from active group challenges — the one exception to the membership lock. At adjudication a departed member is **excluded entirely** (as if they never joined): skipped in outcome computation and pool math, and no ledger entries are created for or against them
  - Delete all user's check-ins
  - **Anonymize** ledger entries: replace `fromName`/`toName` with "Deleted user" but keep amounts (other users may still owe / be owed — data integrity for them)
  - Delete receipts from Storage
  - Delete user doc
- Disable the Firebase Auth account
- Note: hard-deleting ledger entries would break other users' totals. Anonymize instead.

**Firestore backup schedule** (optional, recommended): configure daily export to Cloud Storage bucket for disaster recovery.

## Custom domain

1. Buy a domain (e.g., `habitual.app`, `habitualhabits.com`) via Namecheap, Cloudflare Registrar, etc.
2. In Vercel project → Domains → add your domain
3. Configure DNS at your registrar per Vercel's instructions (usually an A record and a CNAME)
4. Vercel issues an SSL cert automatically (Let's Encrypt via Vercel)
5. Update Firebase Auth **authorized domains** to include the new domain
6. Update any hardcoded URLs (env vars, OG defaults)

## SEO

- Set `<title>` and `<meta name="description">` per route via Next.js metadata API
- OG image for social share previews (1200×630)
- `app/sitemap.ts` generates a sitemap
- `app/robots.ts` sets sensible crawl rules
- Structured data (`Organization` schema) on landing page

## Analytics

Recommendation: **Plausible** (privacy-first, no cookies, GDPR-safe by default) or **PostHog** (more powerful, session recordings, product analytics — but sets cookies, needs consent).

Track:
- Sign-ups (from Firebase Auth trigger or client event)
- Challenge created (per mode / forfeit type)
- Check-ins
- Settlements
- PWA installs
- Notification opt-ins

## Cookie consent

- **Plausible:** none needed — no cookies.
- **PostHog:** show a small banner on first visit; respect user's choice; disable tracking if declined.
- Use a lightweight library (`cookie-consent` or roll your own — it's ~50 lines).

## Legal

- **Terms of Service** — must clearly disclaim:
  - Habitual does not process, hold, or facilitate payment
  - Users are solely responsible for settling debts among themselves
  - Habitual is not liable for disputes between users
  - Charity donations are the user's responsibility; Habitual doesn't verify
  - No warranty, service provided as-is
- **Privacy Policy** — data collected (email, name, timezone, device tokens), retention, deletion process, third-party services (Firebase, Vercel, analytics), cookie usage
- Recommendation: use a template (Termly, Iubenda, or a lawyer-written template from a similar app) and adapt. **Have a lawyer review before public launch** — even without payment processing, a money-adjacent app can attract disputes.

## Icons and images

- **Favicon:** 16×16, 32×32, 48×48 ICO
- **Apple touch icon:** 180×180
- **PWA icons:** 192×192, 512×512, + maskable variant (with safe-area padding)
- **OG image:** 1200×630 default (used on landing, join preview, etc.)

Icon generation tools: `sharp` scripts or `next-pwa-utils`.

## Non-goals

- Localization (English only)
- Referral flow / invites
- A/B testing framework
- Email drip campaigns
- Marketing site separate from the app
- In-app rating prompt

## Manual test checklist

- [ ] Turn off wifi → offline banner appears; app still functional for cached content; no crashes
- [ ] Turn wifi back on → banner clears; queued writes sync
- [ ] Sign out and back in → state fully restored
- [ ] Delete account → all personal data purged; ledger anonymized; re-signup with same email creates a fresh account
- [ ] Favicon renders in browser tab
- [ ] iOS "Add to Home Screen" → icon appears correctly with app name
- [ ] Android install → icon and splash screen render correctly
- [ ] Empty states look intentional (not blank pages)
- [ ] Dark mode across every screen
- [ ] Dynamic type scaling / zoom respected without layout breaks
- [ ] Keyboard nav works on desktop (tab order, focus rings, escape to close modals)
- [ ] Screen reader (VoiceOver / NVDA) can navigate primary flows
- [ ] Custom domain resolves, HTTPS works, no cert warnings
- [ ] Firebase Auth accepts sign-in from the custom domain
- [ ] Analytics captures a signup event end-to-end
- [ ] `/terms` and `/privacy` load and are linked from the footer
- [ ] Cookie consent banner appears once, remembers dismissal

## Acceptance

- Site feels polished across mobile / tablet / desktop
- Custom domain live with HTTPS
- Terms + Privacy published
- Analytics tracking basic events
- PWA installable and behaves correctly when installed
- Ready to share the URL publicly
