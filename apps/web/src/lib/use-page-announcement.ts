import { useEffect, useRef, useState } from "react";

/** Moves focus to the page's main heading (or the main region) so a screen reader starts at the new screen. */
function focusPageHeading() {
  const main = document.getElementById("main-content");
  const heading = main?.querySelector<HTMLElement>("h1");
  const target = heading ?? main;
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

/**
 * Sets the document title to the page name and, when the screen changes after the first load, moves focus
 * to the heading and returns the name for a polite live region (ADR 0040).
 */
export function usePageAnnouncement(page: string) {
  const shown = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    document.title = `${page} · Ledgerline`;
    // Compare with the page already shown, not a first-run flag: React runs effects twice on mount in dev.
    const unchanged = shown.current === null || shown.current === page;
    shown.current = page;
    if (unchanged) return;
    setAnnouncement(page);
    const frame = requestAnimationFrame(focusPageHeading);
    return () => cancelAnimationFrame(frame);
  }, [page]);
  return announcement;
}
