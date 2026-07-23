import { cn } from "@/lib/utils";

/**
 * No stock athletic photography ships with this app, so the hero uses a
 * plain ink gradient instead of the spec's photo-background treatment — the
 * overline/number/label styling and layout otherwise match the spec exactly.
 */
export function StreakHero({ streak, className }: { streak: number; className?: string }) {
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
          <span className="type-display text-[76px] leading-[0.85] text-white lg:text-[130px] lg:leading-[0.8]">
            {streak}
          </span>
          <span className="type-display pb-2 text-2xl text-white lg:pb-4 lg:text-[34px]">
            days
          </span>
        </div>
        <p className="hidden max-w-md text-base text-white/80 lg:block">
          {streak > 0
            ? "Keep today's check-ins coming to keep it alive."
            : "Check in today to start a new streak."}
        </p>
      </div>
    </div>
  );
}
