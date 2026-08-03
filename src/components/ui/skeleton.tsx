import { cn } from "@/lib/utils";

/**
 * One placeholder block, and deliberately the only one.
 *
 * The Habits page used to load three things at once in three different
 * idioms: grey pulsing blocks for the habit list, an animated liquid loader
 * for the leaderboard, and nothing at all for the ledger summary. Three
 * independent fetches, three visual languages, three animation rhythms — so
 * the page didn't read as one thing loading, it read as several things
 * fighting.
 *
 * Every skeleton in the app now comes from here, which means one animation
 * definition and therefore one rhythm: blocks pulse together because they are
 * literally the same CSS class, not because someone matched the durations by
 * hand and will forget to next time.
 *
 * `tone` exists because the leaderboard sits on an always-ink panel, where a
 * `bg-muted` block is invisible in light mode and wrong in dark. It's the
 * surface the block sits on, not a decorative choice.
 */
export function Skeleton({
  tone = "card",
  className,
}: {
  /** "card": on the page background. "ink": on one of the always-dark panels. */
  tone?: "card" | "ink";
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        // motion-reduce: the block still reserves its space and still reads as
        // a placeholder without the pulse, so there's nothing to replace it
        // with for people who've asked the OS for less movement.
        "animate-pulse rounded-md motion-reduce:animate-none",
        tone === "ink" ? "bg-white/10" : "bg-muted",
        className
      )}
    />
  );
}
