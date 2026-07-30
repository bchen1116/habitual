"use client";

import { useEffect, useState } from "react";

/**
 * Ignore small visual-viewport changes so a collapsing browser URL bar (or
 * pull-to-refresh rubber-banding) isn't mistaken for a keyboard.
 */
const KEYBOARD_MIN_HEIGHT = 80;

/**
 * How many pixels of the layout viewport's bottom edge are currently covered
 * by the software keyboard; 0 when it's closed (and always 0 on desktop).
 *
 * Needed because `position: fixed` is anchored to the LAYOUT viewport, which
 * iOS Safari does not shrink when the keyboard opens — so a bottom-anchored
 * sheet stays put and the keyboard slides over the top of it, hiding exactly
 * the input you're typing into. The visual viewport does shrink, so the
 * difference between the two is the keyboard's height.
 *
 * On Chrome this returns ~0 even with the keyboard open, because
 * `interactive-widget=resizes-content` (set in app/layout.tsx) makes the
 * layout viewport itself shrink — the sheet is then already above the
 * keyboard and needs no offset. The two mechanisms compose rather than
 * double-shifting.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(covered > KEYBOARD_MIN_HEIGHT ? Math.round(covered) : 0);
    };

    update();
    // `scroll` matters too: iOS shifts offsetTop when it scrolls a focused
    // field into view, which changes how much is actually covered.
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
