"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface GooeyLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The primary color for the goo effect. Defaults to the Volt accent. */
  primaryColor?: string;
  /** The secondary color for the goo effect. Defaults to a dimmed Volt. */
  secondaryColor?: string;
  /** The color for the bottom border. Defaults to the on-ink empty-bar tone. */
  borderColor?: string;
  /** Accessible label announced while this is on screen. */
  label?: string;
}

/**
 * Gooey liquid loader.
 *
 * Notes on adapting the upstream component to this codebase:
 * - Its defaults were `hsl(var(--primary))`, which assumes shadcn's HSL-triplet
 *   tokens. This project stores hex (`--primary: #d8ff00`), so `hsl(#d8ff00)`
 *   is invalid and the blobs render invisible. The fallbacks use the variables
 *   directly instead.
 * - The SVG filter id and the CSS class are per-instance. The upstream version
 *   hardcodes both, so a second loader on the same page would collide with the
 *   first's `<defs>` id.
 * - The animation is purely decorative, so it's disabled under
 *   `prefers-reduced-motion` with the blobs parked mid-frame — the box still
 *   reads as a filled indicator, and `role="status"` carries the meaning for
 *   assistive tech regardless.
 */
const GooeyLoader = React.forwardRef<HTMLDivElement, GooeyLoaderProps>(
  (
    { className, primaryColor, secondaryColor, borderColor, label = "Loading", ...props },
    ref
  ) => {
    // useId can emit characters that aren't valid in a CSS selector or a
    // url(#…) reference, so strip it down to word characters.
    const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
    const filterId = `gooey-filter-${uid}`;
    const loaderClass = `gooey-loader-${uid}`;

    const style = {
      "--gooey-primary-color": primaryColor || "var(--primary)",
      // Dimmed toward ink rather than a second theme token: this sits on the
      // always-ink panels, so a theme-flipping tone (like --secondary) would
      // vanish in one mode. --primary and --ink are both theme-invariant.
      "--gooey-secondary-color":
        secondaryColor || "color-mix(in srgb, var(--primary) 55%, var(--ink))",
      "--gooey-border-color": borderColor || "var(--ink-bar-empty)",
    } as React.CSSProperties;

    return (
      <div
        ref={ref}
        className={cn("relative flex items-center justify-center text-sm", className)}
        style={style}
        role="status"
        aria-label={label}
        {...props}
      >
        <svg className="absolute h-0 w-0" aria-hidden="true">
          <defs>
            <filter id={filterId}>
              <feGaussianBlur in="SourceGraphic" stdDeviation={12} result="blur" />
              <feColorMatrix
                in="blur"
                mode="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 48 -7"
                result="goo"
              />
              <feComposite in="SourceGraphic" in2="goo" operator="atop" />
            </filter>
          </defs>
        </svg>

        {/* Pseudo-element geometry and keyframes can't be expressed in utility
            classes, so they're scoped here to this instance's generated class. */}
        <style>
          {`
            .${loaderClass} {
              width: 12em;
              height: 3em;
              position: relative;
              overflow: hidden;
              border-bottom: 8px solid var(--gooey-border-color);
              filter: url(#${filterId});
            }

            .${loaderClass}::before,
            .${loaderClass}::after {
              content: '';
              position: absolute;
              border-radius: 50%;
            }

            .${loaderClass}::before {
              width: 22em;
              height: 18em;
              background-color: var(--gooey-primary-color);
              left: -2em;
              bottom: -18em;
              animation: gooey-wee1-${uid} 2s linear infinite;
            }

            .${loaderClass}::after {
              width: 16em;
              height: 12em;
              background-color: var(--gooey-secondary-color);
              left: -4em;
              bottom: -12em;
              animation: gooey-wee2-${uid} 2s linear infinite 0.75s;
            }

            @keyframes gooey-wee1-${uid} {
              0% { transform: translateX(-10em) rotate(0deg); }
              100% { transform: translateX(7em) rotate(180deg); }
            }

            @keyframes gooey-wee2-${uid} {
              0% { transform: translateX(-8em) rotate(0deg); }
              100% { transform: translateX(8em) rotate(180deg); }
            }

            /* Parked at the animation's mid-frame, rotation included: these
               ellipses sit tangent to the bottom of the clipped box when
               unrotated, so translate alone leaves the box empty — it's the
               rotate() that lifts them into view. */
            @media (prefers-reduced-motion: reduce) {
              .${loaderClass}::before {
                animation: none;
                transform: translateX(-1.5em) rotate(90deg);
              }
              .${loaderClass}::after {
                animation: none;
                transform: translateX(0em) rotate(90deg);
              }
            }
          `}
        </style>

        <div className={loaderClass} />
      </div>
    );
  }
);
GooeyLoader.displayName = "GooeyLoader";

export { GooeyLoader };
