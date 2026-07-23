import { cn } from "@/lib/utils";
import type { WeekStripDay } from "@/lib/streak";

export function WeekStrip({ days, percent }: { days: WeekStripDay[]; percent: number }) {
  return (
    <div className="rounded-[20px] bg-ink px-5 py-4 lg:px-[22px] lg:py-[22px]">
      <div className="flex items-baseline justify-between">
        <span className="type-overline text-primary">This week</span>
        <span className="type-display text-2xl text-white lg:text-[26px]">{percent}%</span>
      </div>
      <div className="mt-4 flex gap-1.5 lg:gap-2">
        {days.map((day) => (
          <div key={day.ymd} className="flex flex-1 flex-col items-center gap-1.5">
            <div
              className={cn(
                "h-[34px] w-full rounded-md lg:h-14",
                day.state === "done" ? "bg-primary" : "bg-ink-bar-empty"
              )}
            />
            <span
              className={cn(
                "type-overline text-[11px] lg:text-xs",
                day.isToday ? "text-primary" : "text-ink-label"
              )}
            >
              {day.letter}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
