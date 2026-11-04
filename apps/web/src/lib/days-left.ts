/** How long a deleted person or a cleared ledger can still be brought back (ADR 0049). */
export const undoDays = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the 30 days of a clear end, to the millisecond (the server uses the same moment). */
export const undoEndsAt = (clearedAt: string) =>
  new Date(new Date(clearedAt).getTime() + undoDays * DAY_MS).toISOString();

/** Days still to go until `until`; a part of a day counts as a whole one, and it is never less than 1. */
export const daysLeft = (until: string, now: Date = new Date()) =>
  Math.max(1, Math.ceil((new Date(until).getTime() - now.getTime()) / DAY_MS));

export const daysLeftText = (days: number) =>
  days === 1 ? "1 day left" : `${days} days left`;

/** The pill turns amber at 3 days or fewer. */
export const isUrgent = (days: number) => days <= 3;
