/**
 * One-off backfill for `weeksBefore` on repeat chains.
 *
 * Why it's needed: `weeksBefore` is what lets the second cycle of a weekly
 * habit call itself week 2 instead of week 1 again. Both writers that create a
 * successor — repeatChallengeAdmin (the Repeat button) and writeSuccessor (the
 * auto-repeat job) — set it correctly, but the field was added long after
 * either of them shipped. Every cycle created before that has no value, reads
 * as 0, and starts counting from 1 again.
 *
 * The habit detail page no longer depends on the field (it derives the numbers
 * from the ancestors it has already loaded — see chainWeekOffsets in
 * src/lib/cycles.ts). Today's week strip still does, because it renders one
 * strip per habit and can't afford a read per ancestor just to print a label.
 * So this exists to make that one screen agree with the other.
 *
 * Safe to re-run: it only writes where the stored value differs from the
 * computed one, and it computes from immutable facts (each cycle's start and
 * end dates, which editChallengeAdmin refuses to move once a successor
 * exists).
 *
 * Usage, from the functions/ directory:
 *
 *   # look, change nothing — do this first
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *     node scripts/backfill-weeks-before.mjs --project habitual-f99b8
 *
 *   # actually write
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *     node scripts/backfill-weeks-before.mjs --project habitual-f99b8 --apply
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectId = args[args.indexOf("--project") + 1];
if (!projectId || projectId.startsWith("--")) {
  console.error("Missing --project <id>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

/** Inclusive day count between two yyyymmdd strings. Mirrors functions/src/dates.ts. */
function daysBetweenInclusive(a, b) {
  const toUTC = (ymd) =>
    Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 12);
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000) + 1;
}

const cycleWeeks = (c) => Math.floor(daysBetweenInclusive(c.startDate, c.endDate) / 7);

const snap = await db.collection("challenges").get();
const byId = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

// A chain's root is a cycle nobody points back from. Walking forward from each
// root keeps the running total in one place and visits every cycle exactly
// once, which walking backwards per-cycle would not.
const childOf = new Map();
for (const c of byId.values()) {
  if (c.repeatedFromId && byId.has(c.repeatedFromId)) childOf.set(c.repeatedFromId, c.id);
}
const roots = [...byId.values()].filter(
  (c) => !c.repeatedFromId || !byId.has(c.repeatedFromId)
);

const updates = [];
let chains = 0;
for (const root of roots) {
  let cycle = root;
  // Normally a root is the first cycle of its habit, so nothing came before
  // it. But a root can also be a cycle whose ancestor was *deleted* — it still
  // carries repeatedFromId pointing at a document that no longer exists. Those
  // weeks really did happen, and this script can no longer see them, so it
  // starts from what the cycle already claims rather than resetting it to zero
  // and quietly destroying the only surviving record of them.
  let running = root.repeatedFromId ? (root.weeksBefore ?? 0) : 0;
  let depth = 0;
  const links = [];
  while (cycle && depth++ < 500) {
    const stored = cycle.weeksBefore ?? null;
    if (stored !== running) {
      updates.push({ id: cycle.id, name: cycle.name, from: stored, to: running });
    }
    links.push(`${cycle.id}(${cycleWeeks(cycle)}w)`);
    running += cycleWeeks(cycle);
    const nextId = childOf.get(cycle.id);
    cycle = nextId ? byId.get(nextId) : null;
  }
  if (links.length > 1) {
    chains++;
    console.log(`chain: ${links.join(" -> ")}`);
  }
}

console.log(
  `\n${byId.size} challenges, ${chains} multi-cycle chain(s), ${updates.length} field(s) to correct`
);
for (const u of updates) {
  console.log(`  ${u.id}  "${u.name}"  weeksBefore ${u.from ?? "(absent)"} -> ${u.to}`);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write.");
  process.exit(0);
}
if (updates.length === 0) {
  console.log("\nNothing to write.");
  process.exit(0);
}

// Batched, 400 at a time — under Firestore's 500-write limit with room to spare.
for (let i = 0; i < updates.length; i += 400) {
  const batch = db.batch();
  for (const u of updates.slice(i, i + 400)) {
    batch.update(db.collection("challenges").doc(u.id), { weeksBefore: u.to });
  }
  await batch.commit();
  console.log(`wrote ${Math.min(i + 400, updates.length)}/${updates.length}`);
}
console.log("Done.");
