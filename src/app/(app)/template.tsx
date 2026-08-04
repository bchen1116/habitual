/**
 * Subtle page-transition fade.
 *
 * Deliberately at `(app)/`, not at the app root where it used to live. A
 * template creates a new instance of its children on every navigation — DOM
 * recreated, state discarded, effects re-synchronised — and from the root it
 * sat *above* `(app)/layout.tsx`, so every tab switch tore down AppShell,
 * ActivityProvider and every Firestore listener beneath them and built them
 * again. That is the opposite of what the provider is for: it exists so those
 * subscriptions open once per session rather than once per page view. Below
 * the layout it fades the page and leaves the shell alone.
 *
 * A server component now, and no longer framer-motion: the animation is one
 * opacity keyframe (see globals.css), which does not need a client boundary,
 * a hook, or a 70 kB dependency in the shared bundle.
 *
 * Opacity ONLY, never transform. This wraps every page including the fixed
 * bottom nav, and a CSS transform on an ancestor re-anchors position:fixed
 * descendants to that ancestor instead of the viewport — an earlier 4px
 * translateY sent the nav to the bottom of the *document*, off-screen on any
 * scrolled page, for the duration of every transition.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}
