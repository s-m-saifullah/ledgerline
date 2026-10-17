import { useEffect, useState } from "react";

/** The device's current calendar month as YYYY-MM (never shifted through UTC). */
export function currentMonth(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
export function monthLabel(month: string) {
  const [year, index] = month.split("-").map(Number);
  const local = new Date(0);
  local.setFullYear(year ?? 1, (index ?? 1) - 1, 1);
  local.setHours(12, 0, 0, 0);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(local);
}
/** Re-evaluates when the tab regains focus and at the next local midnight. */
export function useCurrentMonth() {
  const [month, setMonth] = useState(() => currentMonth());
  useEffect(() => {
    const update = () => setMonth(currentMonth());
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      timer = setTimeout(
        () => {
          update();
          schedule();
        },
        Math.min(midnight.getTime() - now.getTime() + 1000, 2_147_000_000),
      );
    };
    const visible = () => {
      if (document.visibilityState === "visible") update();
    };
    schedule();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return month;
}
