"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Subtle page-transition fade; disabled for reduced-motion users.
 *
 * Opacity ONLY — no transform. This wrapper contains every page including
 * the fixed bottom nav, and a CSS transform on an ancestor re-anchors
 * position:fixed descendants to that ancestor instead of the viewport. The
 * old 4px translateY slide made the bottom nav jump to the bottom of the
 * DOCUMENT (off-screen on any scrolled/long page) for the duration of
 * every page transition, then snap back once framer removed the settled
 * transform.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <>{children}</>;
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
