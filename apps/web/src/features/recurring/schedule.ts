import {
  occurrencesBetween,
  type RecurringFrequency,
  type Schedule,
} from "@ledgerline/shared";

const units: Record<RecurringFrequency, [string, string]> = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};
/** A calendar date such as "1 Nov 2026", read from the text so no time zone can shift it. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
/** "Every month", "Every 2 weeks". */
export function everySentence(
  frequency: RecurringFrequency,
  interval: number,
): string {
  const [one, many] = units[frequency];
  return interval === 1 ? `Every ${one}` : `Every ${interval} ${many}`;
}
/** Today in the ledger's time zone (the same rule the server uses to decide what is due). */
export function ledgerToday(timeZone: string | null, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
type Window = Schedule & { endDate: string | null };
/** The next few dates on or after `from`, honoring the end date. */
export function upcomingDates(
  schedule: Window,
  from: string,
  count = 3,
): string[] {
  const last = schedule.endDate ?? "9999-12-31";
  return occurrencesBetween(
    schedule,
    from > schedule.startDate ? from : schedule.startDate,
    last,
    count,
  );
}
/** How many occurrences are already due when the rule is saved (they are created right away). */
export function dueNow(schedule: Window, today: string): number {
  const last =
    schedule.endDate && schedule.endDate < today ? schedule.endDate : today;
  if (schedule.startDate > last) return 0;
  return occurrencesBetween(schedule, schedule.startDate, last, 1000).length;
}
