import { useEffect, useState } from "react";

const wideNow = (min: number) => document.body.clientWidth >= min;

/**
 * Whether the page is at least `min` px wide, read from the element the layout's container queries read (the
 * body, `layout.css`). Only for deciding whether to fetch what a wide layout shows; the layout itself is CSS.
 */
export function useAppWide(min: number) {
  const [wide, setWide] = useState(() => wideNow(min));
  useEffect(() => {
    const body = document.body;
    const update = () => setWide(wideNow(min));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(body);
    return () => observer.disconnect();
  }, [min]);
  return wide;
}
