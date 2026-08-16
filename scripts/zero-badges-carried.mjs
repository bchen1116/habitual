/**
 * One-off: clear every carried spare-skip balance.
 *
 * Spares used to be awarded for meeting a habit's weekly target rather than
 * for a perfect week, so a 5x/week habit banked one for the five check-ins it
 * had already promised — every week, without ever exceeding its terms. The
 * rule is now all seven days (src/lib/badges.ts), and everything the app
 * derives from check-ins corrects itself the moment that ships.
 *
 * `badgesCarried` is the one exception, and the only reason this script
 * exists: it's a stored accumulator, written at grading and rolled onto each
 * successor cycle, so wrongly-earned spares survive there until spent. Both
 * places that read it — adjudication's `balance` and repeatChallengeAdmin's
 * carry-forward — recompute everything *else* from check-ins under the new
 * rule, which is why zeroing this single field is a complete fix rather than
 * a partial one.
 *
 * Every member doc, not just live cycles: an adjudicated cycle can still be
 * repeated, and repeatChallengeAdmin reads its `badgesCarried` when it is.
 * Leaving graded cycles alone would let a stale balance re-enter through the
 * Repeat button months later.
 *
 * `badgesEarned` and `badgesSpent` are deliberately untouched. Those are the
 * frozen record of what a graded cycle actually decided — the audit trail for
 * a result that has already moved money — and rewriting them would make a
 * settled outcome unexplainable. This only clears the forward balance.
 *
 * Dry run by default; nothing is written without --apply:
 *   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccount.json)" \
 *     node scripts/zero-badges-carried.mjs
 *   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccount.json)" \
 *     node scripts/zero-badges-carried.mjs --apply
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
/** Also delete applied spares. Opt-in, and read the warning below first. */
const CLEAR_APPLIED = process.argv.includes("--clear-applied");

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!raw) {
  console.error(
    "FIREBASE_SERVICE_ACCOUNT_KEY is not set. Export the same service-account\n" +
      "JSON the app uses, e.g.\n" +
      '  export FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccount.json)"'
  );
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();

// Firestore caps a batch at 500 operations.
const BATCH_LIMIT = 500;

async function commitInChunks(docs, write) {
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + BATCH_LIMIT)) write(batch, doc);
    await batch.commit();
  }
}

async function main() {
  console.log(APPLY ? "APPLYING changes.\n" : "DRY RUN — nothing will be written.\n");

  const members = await db.collectionGroup("members").get();

  // Only docs that actually carry something. A field already 0 or absent is
  // correct as it stands, and writing it would churn documents for nothing.
  const carrying = members.docs.filter((doc) => {
    const value = doc.data().badgesCarried;
    return typeof value === "number" && value !== 0;
  });

  const totalSpares = carrying.reduce(
    (sum, doc) => sum + doc.data().badgesCarried,
    0
  );

  console.log(`Member docs scanned:        ${members.size}`);
  console.log(`Carrying a balance:         ${carrying.length}`);
  console.log(`Spares to be cleared:       ${totalSpares}`);

  const byUid = new Map();
  for (const doc of carrying) {
    byUid.set(doc.id, (byUid.get(doc.id) ?? 0) + doc.data().badgesCarried);
  }
  if (byUid.size > 0) {
    console.log(`\nPeople affected (${byUid.size}):`);
    for (const [uid, count] of [...byUid].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${uid}  ${count} spare${count === 1 ? "" : "s"}`);
    }
  }

  // Applied spares are a separate collection and a much sharper edge: an
  // applied spare is live cover on an ungraded cycle (grading compares misses
  // against base + applied), so deleting one can turn a pass into a forfeited
  // stake. Reported rather than cleared unless asked for explicitly.
  const spares = await db.collectionGroup("spares").get();
  const applied = spares.docs.filter((doc) => (doc.data().count ?? 0) > 0);
  if (applied.length > 0) {
    console.log(`\n⚠ ${applied.length} applied spare doc(s) found.`);
    for (const doc of applied) {
      const { uid, count } = doc.data();
      console.log(`  ${doc.ref.path}  uid=${uid} count=${count}`);
    }
    console.log(
      CLEAR_APPLIED
        ? "  --clear-applied given: these WILL be deleted."
        : "  Left alone. These are live cover on a cycle that hasn't been graded,\n" +
            "  so removing one can turn a pass into a forfeited stake. Re-run with\n" +
            "  --clear-applied only if that is what you want."
    );
  } else {
    console.log("\nNo applied spares — nothing was committed to a missed week.");
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write.");
    return;
  }

  await commitInChunks(carrying, (batch, doc) =>
    batch.update(doc.ref, { badgesCarried: 0 })
  );
  console.log(`\nCleared ${carrying.length} balance(s).`);

  if (CLEAR_APPLIED && applied.length > 0) {
    await commitInChunks(applied, (batch, doc) => batch.delete(doc.ref));
    console.log(`Deleted ${applied.length} applied spare doc(s).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
