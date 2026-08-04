"use client";

import { cn } from "@/lib/utils";

/**
 * No stock athletic photography ships with this app, so the hero uses a
 * plain ink gradient instead of the spec's photo-background treatment — the
 * overline/number/label styling and layout otherwise match the spec exactly.
 */
export function StreakHero({
  streak,
  weeks,
  pending = false,
  className,
}: {
  streak: number;
  /** Calendar span of the same run — the "how long has this been going?" the check-in count alone can't answer. */
  weeks: number;
  /**
   * The number isn't final yet. Shows a placeholder rather than a provisional
   * figure: this is the largest text on the home screen, so a value that
   * changes after it's been read is read as the app being wrong, not as it
   * having finished loading.
   */
  pending?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex h-[210px] items-end overflow-hidden rounded-3xl px-5 py-5 lg:h-[300px] lg:items-center lg:px-8",
        className
      )}
      style={{ backgroundImage: "linear-gradient(135deg, #2c2c2a 0%, #111111 70%)" }}
    >
      <div className="flex flex-col gap-1">
        <span className="type-overline text-primary">Current streak</span>
        <div className="flex items-end gap-2">
          {pending ? (
            <span
              role="status"
              aria-label="Loading your current streak"
              className="my-[6px] h-[65px] w-[104px] animate-pulse rounded-2xl bg-white/15 lg:my-[13px] lg:h-[104px] lg:w-[168px]"
            />
          ) : (
            <span
              // Keyed on the value so React remounts it when the streak
              // changes, which is what restarts the CSS animation.
              key={streak}
              className="type-display animate-pop-in text-[76px] leading-[0.85] text-white lg:text-[130px] lg:leading-[0.8]"
            >
              {streak}
            </span>
          )}
          <span className="type-display pb-2 text-2xl text-white lg:pb-4 lg:text-[34px]">
            days
          </span>
        </div>
        {/* Subheader, deliberately butted up against the number rather than
            in the paragraph below: for an N×/week habit the two say different
            things (50 check-ins across 10 weeks) and only read as one fact if
            they sit together. Hidden under a week so a new streak doesn't
            announce "0 weeks unbroken". */}
        {!pending && weeks > 0 && (
          <span className="type-overline text-xs text-primary lg:text-sm">
            {weeks} week{weeks === 1 ? "" : "s"} unbroken
          </span>
        )}
        {/* Both of these read off the streak, so they'd be making the same
            unfinished claim the number is holding back on — "start a new
            streak" is actively wrong for someone who has one. */}
        {!pending && (
          <p className="hidden max-w-md text-base text-white/80 lg:block">
            {streak > 0
              ? "Keep today's check-ins coming to keep it alive."
              : "Check in today to start a new streak."}
          </p>
        )}
      </div>
    </div>
  );
}
