import type { Contact, Receivable } from "@ledgerline/shared";

/** The chips above the list (ADR 0047): who owes, who does not, everyone, and the archived ones. */
export type ClientFilter = "open" | "settled" | "all" | "archived";

/** A client with anything owed, in any currency (money in a currency with no rate still counts). */
export const isOpenClient = (client: Contact) => client.openBalances.length > 0;

/** The most owed (in dollars at today's rates) first, then by name. */
export function sortClients(clients: readonly Contact[]) {
  return [...clients].sort(
    (a, b) =>
      b.openBalance.amount - a.openBalance.amount ||
      a.name.localeCompare(b.name),
  );
}

export const clientMatches = (client: Contact, text: string) =>
  client.name.toLowerCase().includes(text.trim().toLowerCase());

const inFilter = (client: Contact, filter: ClientFilter) =>
  filter === "all" ||
  (filter === "open" && isOpenClient(client)) ||
  (filter === "settled" && !isOpenClient(client)) ||
  (filter === "archived" && !!client.archivedAt);

export function visibleClients(
  clients: readonly Contact[],
  filter: ClientFilter,
  text: string,
) {
  return sortClients(clients).filter(
    (client) => inFilter(client, filter) && clientMatches(client, text),
  );
}

/** What each chip would show, whatever is typed in the search box. */
export function filterCounts(clients: readonly Contact[]) {
  const count = (filter: ClientFilter) =>
    clients.filter((client) => inFilter(client, filter)).length;
  return {
    open: count("open"),
    settled: count("settled"),
    all: count("all"),
    archived: count("archived"),
  };
}

/** Open while someone owes money; with nobody owing, every client, so a new one is not hidden. */
export const defaultFilter = (clients: readonly Contact[]): ClientFilter =>
  clients.some(isOpenClient) ? "open" : "all";

/** The chip the owner chose; with none chosen, or Archived once nobody is archived, the default one. */
export function resolveFilter(
  chosen: ClientFilter | null,
  clients: readonly Contact[],
): ClientFilter {
  if (!chosen || (chosen === "archived" && !clients.some((c) => c.archivedAt)))
    return defaultFilter(clients);
  return chosen;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "Oct 16", with the year ("Dec 3, 2025") when it is not this year. */
export function shortDate(date: string, thisYear: number) {
  const [year, month, day] = date.split("-").map(Number);
  const text = `${MONTHS[(month ?? 1) - 1]} ${day}`;
  return year === thisYear ? text : `${text}, ${year}`;
}

/** Whole days from one YYYY-MM-DD date to another, by calendar date (no clock, no time zone). */
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );

/** A client row's one hint: how long the oldest unpaid service has waited, or that it is archived. */
export function clientHint(client: Contact, today: string) {
  const oldest = client.oldestOpenServiceDate;
  if (!oldest) return client.archivedAt ? "Archived" : undefined;
  const days = daysBetween(oldest, today);
  const ago = days <= 0 ? "today" : `${days}d ago`;
  return `Oldest unpaid ${ago} · ${shortDate(oldest, Number(today.slice(0, 4)))}`;
}

export type ServiceState = "overdue" | "unpaid" | "partly" | "paid" | "written";

/** Overdue is worked out here, as it always was: money left, a due date, and a day gone by. */
export function serviceState(service: Receivable, today: string): ServiceState {
  if (service.status === "writtenOff") return "written";
  if (service.status === "paid") return "paid";
  // A service that is not paid or written off has money left, so a due date in the past is all it takes.
  if (service.dueDate && service.dueDate < today) return "overdue";
  return service.status === "partlyPaid" ? "partly" : "unpaid";
}

export const overdueCount = (services: readonly Receivable[], today: string) =>
  services.filter((service) => serviceState(service, today) === "overdue")
    .length;

/** "Paid in Oct": the month of the figure beside it. */
export function paidInLabel(month: string) {
  return `Paid in ${MONTHS[Number(month.slice(5, 7)) - 1]}`;
}
