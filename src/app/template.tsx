"use client";

import { motion } from "framer-motion";

/**
 * Subtle page-transition fade.
 *
 * Opacity ONLY — no transform. This wrapper contains every page including
 * the fixed bottom nav, and a CSS transform on an ancestor re-anchors
 * position:fixed descendants to that ancestor instead of the viewport. The
 * old 4px translateY slide made the bottom nav jump to the bottom of the
 * DOCUMENT (off-screen on any scrolled/long page) for the duration of
 * every page transition, then snap back once framer removed the settled
 * transform.
 *
 * There is deliberately no `useReducedMotion()` branch. It used to return
 * `<>{children}</>` for those users, but that hook can't read the media
 * query during SSR — so the server always rendered the wrapper div and a
 * reduced-motion client rendered bare children, a structural mismatch that
 * failed hydration and forced React to throw away the server HTML and
 * re-render the whole tree on every navigation. Since the only remaining
 * effect is a fade (no movement, nothing vestibular), running it for
 * everyone is both accessible and structurally identical on both sides.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
