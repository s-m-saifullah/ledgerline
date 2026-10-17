/** The calendar date (YYYY-MM-DD) at this moment in an IANA time zone; UTC when the zone is not set. */
export function localDate(now: Date, timeZone: string | null): string {
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
