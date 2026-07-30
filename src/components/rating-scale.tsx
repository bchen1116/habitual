"use client";

import { useRef } from "react";
import { MAX_RATING, MIN_RATING } from "@/lib/reflections";
import { cn } from "@/lib/utils";

const VALUES = Array.from(
  { length: MAX_RATING - MIN_RATING + 1 },
  (_, i) => MIN_RATING + i
);

interface RatingScaleProps {
  value: number | null;
  onChange: (value: number | null) => void;
  label?: string;
}

/**
 * The 1–10 "how did it go" scale.
 *
 * Notes on the choices here:
 * - Selected reads ink-filled, not volt. The Volt spec allows exactly one
 *   volt element per screen and in every dialog that shows this scale, that
 *   budget is already spent on the primary button.
 * - Tapping the selected value again clears it. There is no other way back to
 *   "didn't rate this" once you've touched the scale, and a rating you can't
 *   withdraw is a rating people stop giving honestly.
 * - Real radiogroup semantics with a roving tabindex: ten separate tab stops
 *   for one question is miserable with a keyboard or a switch device, and
 *   arrow keys are what a rating scale is expected to answer to.
 */
export function RatingScale({ value, onChange, label = "How did it go?" }: RatingScaleProps) {
  const groupRef = useRef<HTMLDivElement | null>(null);

  // The one stop in the tab order: the current selection, or the low end when
  // nothing is selected yet.
  const focusValue = value ?? MIN_RATING;

  function move(delta: number) {
    const next = Math.min(MAX_RATING, Math.max(MIN_RATING, focusValue + delta));
    onChange(next);
    groupRef.current
      ?.querySelector<HTMLButtonElement>(`[data-rating="${next}"]`)
      ?.focus();
  }

  return (
    <div>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={label}
        className="grid grid-cols-10 gap-1"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
          }
        }}
      >
        {VALUES.map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${n} out of ${MAX_RATING}`}
              data-rating={n}
              tabIndex={n === focusValue ? 0 : -1}
              onClick={() => onChange(selected ? null : n)}
              className={cn(
                "flex h-11 items-center justify-center rounded-md text-sm font-bold tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "bg-foreground text-background"
                  : "bg-secondary text-muted-foreground hover:bg-accent"
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between">
        <span className="type-overline text-[10px] text-muted-foreground">Rough</span>
        <span className="type-overline text-[10px] text-muted-foreground">Great</span>
      </div>
    </div>
  );
}
