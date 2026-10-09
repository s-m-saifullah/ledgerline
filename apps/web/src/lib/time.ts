/** "14:05" becomes "2:05 PM". Values that are not a valid HH:mm time are returned unchanged. */
export function formatTime12(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = match[2] as string;
  if (hour > 23 || Number(minute) > 59) return value;
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}
/** The 24-hour "HH:mm" for a 12-hour clock reading, or null when it is not a valid time. */
export function to24Hour(
  hour: string,
  minute: string,
  period: "AM" | "PM",
): string | null {
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null;
  const h = Number(hour);
  const m = Number(minute);
  if (h < 1 || h > 12 || m > 59) return null;
  const h24 = (h % 12) + (period === "PM" ? 12 : 0);
  return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
