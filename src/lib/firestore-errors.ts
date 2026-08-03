/**
 * Turning a Firestore failure into something the person reading it can act on.
 *
 * Two of its error codes have a specific, common, and entirely operational
 * cause in this app: rules and indexes deploy separately from the app itself
 * (`firebase deploy --only firestore:rules,firestore:indexes`), so a build can
 * reach production days before they do. When that happens every affected read
 * fails with the same two codes, and a generic "couldn't load" sends whoever
 * sees it looking for a bug in code that is working exactly as written.
 */

/** `permission-denied` — the deployed rules don't (yet) allow this read. */
const DENIED = "permission-denied";
/** `failed-precondition` — a composite or collection-group index is missing. */
const NO_INDEX = "failed-precondition";

export function firestoreErrorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/**
 * A sentence to show under a failed section, or null when the cause isn't one
 * of the two operational ones — in which case the caller's own generic message
 * is the honest thing to say, because we genuinely don't know.
 */
export function firestoreErrorHint(err: unknown): string | null {
  const code = firestoreErrorCode(err);
  if (code === DENIED) {
    return "Your Firestore security rules may be out of date — deploy them and try again.";
  }
  if (code === NO_INDEX) {
    return "A Firestore index is still missing — deploy your indexes and try again.";
  }
  return null;
}
