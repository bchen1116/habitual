"use client";

import { useRouter } from "next/navigation";

/**
 * The way off a detail screen.
 *
 * The app's manifest sets `display: "standalone"`, so once it's installed
 * there is no browser chrome and no address bar — the only way back is
 * whatever the page itself puts there. A muted text link off to the right
 * technically qualified and in practice didn't read as one, which is the whole
 * of the bug: on a phone the back control belongs top-left, at a size a thumb
 * can hit, looking like something you press.
 *
 * It goes back through history rather than at a fixed parent route, because
 * the same habit is reached from Today, from Habits, and from Groups, and a
 * link that always lands on one of them is wrong the other two times. A cold
 * open — a shared link, a notification tap, a refresh — has no in-app history
 * to return to and would otherwise leave the app entirely, so those fall
 * through to `fallbackHref`.
 */
export function BackButton({
  fallbackHref,
  label = "Back",
}: {
  /** Where to land when there's no in-app history — a shared link opened cold. */
  fallbackHref: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        // Read at click time rather than on mount: no state, so no chance of
        // rendering one thing on the server and another after hydration.
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-accent"
    >
      {/* 44px of tap target around a 20px glyph — the icon is the smallest
          part of this control, not the size of it. */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  );
}
