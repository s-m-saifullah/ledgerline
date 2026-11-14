import { localDate } from "@ledgerline/shared";

/** The time zone of this device. */
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Today's date (YYYY-MM-DD) on this device's clock and time zone. */
export function localToday(now = new Date()) {
  return localDate(now, deviceZone());
}
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const short = (month: number) => (MONTHS[month - 1] as string).slice(0, 3);

/** A real calendar day read from "YYYY-MM-DD" text (so no time zone can move it), or null. */
function parseDay(value: string) {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!found) return null;
  const year = Number(found[1]);
  const month = Number(found[2]);
  const day = Number(found[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return { year, month, day, weekday: date.getUTCDay() };
}
const isTimestamp = (value: string) =>
  /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(new Date(value).getTime());

/**
 * A day the way every screen writes it: "Nov 1", with the year ("Dec 31, 2025") only when it is not this year.
 * `value` is a YYYY-MM-DD date or an ISO timestamp (read as the day it fell on in `timeZone`, this device's by
 * default); `today` is the day that decides what "this year" is. Anything else is returned unchanged.
 */
export function formatDay(
  value: string,
  today = localToday(),
  timeZone?: string,
): string {
  const day = parseDay(
    isTimestamp(value)
      ? localDate(new Date(value), timeZone ?? deviceZone())
      : value,
  );
  if (!day) return value;
  const text = `${short(day.month)} ${day.day}`;
  return day.year === Number(today.slice(0, 4)) ? text : `${text}, ${day.year}`;
}

/** A moment as "Nov 1, 2:05 PM", with the year ("Nov 1, 2025, 2:05 PM") when it is not this year. */
export function formatDayTime(
  value: string,
  now = new Date(),
  timeZone = deviceZone(),
): string {
  if (!isTimestamp(value)) return value;
  const at = new Date(value);
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) =>
    clock.find((item) => item.type === type)?.value ?? "00";
  return `${formatDay(localDate(at, timeZone), localDate(now, timeZone))}, ${formatTime12(
    `${part("hour")}:${part("minute")}`,
  )}`;
}

/** A day with its weekday and always its year, for a day head: "Mon, Nov 2, 2026". */
export function formatDayHead(date: string): string {
  const day = parseDay(date);
  if (!day) return date;
  return `${WEEKDAYS[day.weekday]}, ${short(day.month)} ${day.day}, ${day.year}`;
}

/** The short name of a month from "YYYY-MM", for a chart label: "Nov". */
export function formatMonthShort(month: string): string {
  const found = /^\d{4}-(\d{2})$/.exec(month);
  const index = Number(found?.[1]);
  return found && index >= 1 && index <= 12 ? short(index) : month;
}

/** The full name of a month, counted from 0: "January". */
export function formatMonthLong(index: number): string {
  return MONTHS[index] ?? "";
}

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
