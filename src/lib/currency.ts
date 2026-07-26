// No "use client" here on purpose — this needs to be callable from Server
// Components (e.g. src/app/join/[code]/page.tsx's generateMetadata and page
// body), and a module's client/server-ness in the App Router is all-or-
// nothing per file. It used to live in lib/ledger.ts, which is "use client"
// for its Firestore/Storage calls — fine for every client component that
// imports it, but calling any of its exports (including this pure, side
// effect-free formatter) directly from a Server Component throws "Attempted
// to call formatAmount() from the server but formatAmount is on the client."

export function formatAmount(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}
