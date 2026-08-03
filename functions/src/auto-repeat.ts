import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { addDaysYmd, dateToYmdUTC, daysBetweenInclusive } from "./dates";
import { repeatDurationDays } from "./duration";
import { sendPushToMany } from "./notifications";

/**
 * Habits that keep going on their own.
 *
 * The whole feature turns on one deadline: the successor must exist *before*
 * the current cycle ends, not after. A chain's streak only carries across a
 * seam when the next cycle starts the very day after the last one finished —
 * walkChainWith (src/lib/chain-core.ts) breaks the walk on
 * `addDaysYmd(ancestor.endDate, 1) !== childStartDate`, and treats any gap as
 * a restart. Adjudication doesn't run until 39 hours past the end date (it
 * has to wait for the last timezone on earth to finish its final day), so
 * creating the successor there would always leave a one- or two-day hole and
 * reset the very streak auto-repeat exists to protect.
 *
 * So this runs ahead of the end date instead, and the successor starts at
 * endDate + 1 with nothing retroactive about it. The cost is that grading
 * hasn't happened yet, so badges earned in the final cycle aren't known here.
 * Adjudication settles that afterwards by writing the graded total onto the
 * successor's member docs — see the autoRepeatedToId branch in adjudicate.ts.
 */

/**
 * How far ahead of an end date the successor is created. A full day of margin
 * against a skipped or failed run — a habit ending Sunday gets its successor
 * on Saturday's run, and if that run dies, Sunday's still makes it before
 * Monday begins anywhere.
 */
export const AUTO_REPEAT_LEAD_HOURS = 24;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Feb 10" — for push copy only; nothing here parses it back. */
function formatYmdShort(ymd: string): string {
  return `${MONTHS[Number(ymd.slice(4, 6)) - 1]} ${Number(ymd.slice(6, 8))}`;
}

/** Cycles ending on or before this date get their successor on this run. */
export function autoRepeatHorizonYmd(now: Date): string {
  return dateToYmdUTC(new Date(now.getTime() + AUTO_REPEAT_LEAD_HOURS * 60 * 60 * 1000));
}

interface AutoRepeatChallenge {
  status: string;
  autoRepeat?: boolean;
  autoRepeatedToId?: string | null;
  startDate: string;
  endDate: string;
}

/**
 * Whether a successor should be created for this cycle right now.
 *
 * The lower bound is the part worth stating: a cycle whose successor would
 * already have started is deliberately left alone. Members can't check into
 * days that are already past (the ±1-day rule in firestore.rules sees to
 * that), so a retroactive cycle would open with missed days nobody could have
 * filled — and those missed days move real money. The manual Repeat button
 * handles that case honestly, by starting today.
 */
export function shouldAutoRepeat(
  challenge: AutoRepeatChallenge,
  now: Date
): boolean {
  if (challenge.autoRepeat !== true) return false;
  if (challenge.status !== "active") return false;
  if (challenge.endDate > autoRepeatHorizonYmd(now)) return false;
  return addDaysYmd(challenge.endDate, 1) >= dateToYmdUTC(now);
}

// Mirrors JOIN_ALPHABET/generateUniqueJoinCode in
// src/lib/server/challenge-admin.ts. A successor can't inherit its
// predecessor's code: for the day both are active, a lookup by code
// (getChallengePreview) would have two candidates and pick arbitrarily.
const JOIN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 6;

async function generateUniqueJoinCode(): Promise<string> {
  const db = getFirestore();
  for (let attempt = 0; attempt < 3; attempt++) {
    let code = "";
    for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
      code += JOIN_ALPHABET[Math.floor(Math.random() * JOIN_ALPHABET.length)];
    }
    const clash = await db
      .collection("challenges")
      .where("joinCode", "==", code)
      .where("status", "==", "active")
      .limit(1)
      .get();
    if (clash.empty) return code;
  }
  throw new Error("Could not generate a unique join code");
}

/**
 * Creates the next cycle for every habit set to auto-repeat that is about to
 * end. Returns the number created.
 */
export async function autoRepeatEndingChallenges(now: Date): Promise<number> {
  const db = getFirestore();
  const horizon = autoRepeatHorizonYmd(now);

  const due = await db
    .collection("challenges")
    .where("autoRepeat", "==", true)
    .where("status", "==", "active")
    .where("endDate", "<=", horizon)
    .get();

  let created = 0;
  for (const doc of due.docs) {
    try {
      const data = doc.data() as AutoRepeatChallenge;
      if (!shouldAutoRepeat(data, now)) continue;

      // Already done — unless the successor it names doesn't exist, which
      // means a previous run reserved the link and then failed to write the
      // cycle. Clearing it turns what would be a permanently un-repeating
      // habit into a one-day delay.
      if (data.autoRepeatedToId) {
        const successor = await db
          .collection("challenges")
          .doc(data.autoRepeatedToId)
          .get();
        if (successor.exists) continue;
        logger.warn(
          `auto-repeat: ${doc.id} points at missing successor ${data.autoRepeatedToId}; retrying`
        );
        await doc.ref.update({ autoRepeatedToId: null });
      }

      const newRef = db.collection("challenges").doc();

      // Claim the successor slot before writing it, so two overlapping runs
      // can't both create one. Whoever loses the compare-and-set sees a
      // non-null autoRepeatedToId and bails.
      const claimed = await db.runTransaction(async (t) => {
        const fresh = await t.get(doc.ref);
        const current = fresh.data() as AutoRepeatChallenge | undefined;
        if (!current || !shouldAutoRepeat(current, now)) return false;
        if (current.autoRepeatedToId) return false;
        t.update(doc.ref, { autoRepeatedToId: newRef.id });
        return true;
      });
      if (!claimed) continue;

      await writeSuccessor(doc.id, newRef, now);
      created++;

      const full = (await newRef.get()).data();
      const memberIds = (full?.memberIds as string[]) ?? [];
      if (memberIds.length > 0) {
        await sendPushToMany(memberIds, {
          title: "Next cycle is set",
          // The date rather than "tomorrow": the run is a day ahead of the
          // end date, but a retry the following day isn't, and a push that
          // says the wrong day about money is worse than a plain one.
          body: `"${full?.name}" carries on — the next cycle runs ${formatYmdShort(
            full?.startDate as string
          )} to ${formatYmdShort(full?.endDate as string)}, same terms as before.`,
          targetUrl: `/challenges/${newRef.id}`,
          category: "challengeLifecycle",
        }).catch((err) => logger.warn("auto-repeat push failed", err));
      }
    } catch (err) {
      // One bad habit must not block the rest; it retries on the next run,
      // which is why the lead time is a full day rather than an hour.
      logger.error(`Auto-repeat failed for challenge ${doc.id}`, err);
    }
  }
  return created;
}

/**
 * Writes the successor and its members in one batch — all of it or none, so a
 * partial failure can never leave a challenge whose members can't check in.
 *
 * Mirrors repeatChallengeAdmin (src/lib/server/challenge-admin.ts) field for
 * field, minus the stake/skip edits it offers: an unattended job changes no
 * terms. Anything the creator would have adjusted, they adjust on the new
 * cycle.
 */
async function writeSuccessor(
  oldId: string,
  newRef: FirebaseFirestore.DocumentReference,
  now: Date
): Promise<void> {
  const db = getFirestore();
  const oldRef = db.collection("challenges").doc(oldId);
  const [snap, memberDocs] = await Promise.all([
    oldRef.get(),
    oldRef.collection("members").get(),
  ]);
  const data = snap.data()!;

  const newStartDate = addDaysYmd(data.endDate, 1);
  const days = repeatDurationDays(
    daysBetweenInclusive(data.startDate, data.endDate)
  );
  const joinCode = data.mode === "group" ? await generateUniqueJoinCode() : null;

  const batch = db.batch();
  batch.set(newRef, {
    name: data.name,
    description: data.description ?? null,
    createdBy: data.createdBy,
    mode: data.mode,
    forfeitType: data.forfeitType,
    charityName: data.charityName ?? null,
    joinCode,
    joinPolicy: data.joinPolicy ?? null,
    joinClosed: data.mode === "group" ? false : null,
    visibility: data.visibility ?? "public",
    maxMembers: data.maxMembers ?? null,
    frequency: data.frequency,
    skipDays: data.skipDays,
    stakeAmount: data.stakeAmount,
    startDate: newStartDate,
    endDate: addDaysYmd(newStartDate, days - 1),
    // The successor repeats too, or "auto-repeat" would mean "once more".
    autoRepeat: true,
    autoRepeatedToId: null,
    status: "active",
    memberIds: memberDocs.docs.map((d) => d.id),
    repeatedFromId: oldId,
    createdAt: FieldValue.serverTimestamp(),
  });

  for (const memberDoc of memberDocs.docs) {
    const member = memberDoc.data();
    batch.set(newRef.collection("members").doc(memberDoc.id), {
      displayName: member.displayName,
      username: member.username ?? null,
      joinedAt: FieldValue.serverTimestamp(),
      joinedDate: newStartDate,
      // Whatever was banked at this point. The final cycle's own badges
      // aren't graded yet — adjudication overwrites this with the settled
      // total once it runs (see adjudicate.ts).
      badgesCarried: (member.badgesCarried as number | undefined) ?? 0,
      charityName: member.charityName ?? null,
      outcome: null,
      completedCount: 0,
      skipsUsed: 0,
    });
  }

  await batch.commit();
  logger.info(
    `auto-repeat: ${oldId} -> ${newRef.id} starting ${newStartDate} (run ${dateToYmdUTC(now)})`
  );
}
