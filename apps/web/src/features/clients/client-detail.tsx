import type { Contact, Receivable, ReceivableEvent } from "@ledgerline/shared";
import {
  EmptyState,
  IconTile,
  ListCard,
  ListRow,
  SectionLabel,
  SegmentedControl,
} from "@ledgerline/ui";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  EllipsisVertical,
  HandCoins,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Amount } from "../../components/amount-text";
import { LoadError } from "../../components/load-error";
import { Overlay } from "../../components/overlay";
import { localToday } from "../../lib/time";
import { getClient, getHistory, getServices } from "./api";
import { Balances } from "./balances";
import {
  overdueCount,
  paidInLabel,
  type ServiceState,
  serviceState,
  shortDate,
} from "./model";
import { ServicePill, ServiceSheet } from "./service-sheet";
import { useClientsWorkspace } from "./workspace";

const labels: Record<ReceivableEvent["action"], string> = {
  created: "Service logged",
  edited: "Service corrected",
  deleted: "Service deleted",
  restored: "Service restored",
  writtenOff: "Remainder written off",
  reopened: "Service reopened",
  paymentCreated: "Payment received",
  paymentEdited: "Payment corrected",
  paymentDeleted: "Payment deleted",
  paymentRestored: "Payment restored",
};
const when = (stamp: string) =>
  new Date(stamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const finished = (state: ServiceState) =>
  state === "paid" || state === "written";

/** Edit, archive and delete, in a sheet behind the card's menu button. */
function ClientMenu({
  client,
  onClose,
}: {
  client: Contact;
  onClose: () => void;
}) {
  const workspace = useClientsWorkspace();
  const blocked = workspace?.blocked ?? false;
  const row = (
    icon: React.ReactNode,
    title: string,
    run: () => void,
    danger = false,
  ) => (
    <button
      type="button"
      className="ui-row ui-row-press"
      disabled={blocked}
      onClick={() => {
        onClose();
        run();
      }}
    >
      <span className={danger ? "cl-danger-tile" : undefined}>
        <IconTile>{icon}</IconTile>
      </span>
      <span className="ui-row-main">
        <span className={danger ? "ui-row-title cl-danger" : "ui-row-title"}>
          {title}
        </span>
      </span>
    </button>
  );
  return (
    <Overlay
      open
      title={client.name}
      busy={false}
      onDismiss={onClose}
      returnFocusId="client-menu"
      fallbackFocusId="main-content"
    >
      <ListCard>
        {row(<Pencil size={20} aria-hidden="true" />, "Edit client", () =>
          workspace?.open({ kind: "contact", client }, "client-menu"),
        )}
        {row(
          client.archivedAt ? (
            <ArchiveRestore size={20} aria-hidden="true" />
          ) : (
            <Archive size={20} aria-hidden="true" />
          ),
          client.archivedAt ? "Unarchive client" : "Archive client",
          () =>
            workspace?.open(
              {
                kind: "action",
                action: client.archivedAt ? "unarchive" : "archive",
                client,
              },
              "client-menu",
            ),
        )}
        {row(
          <Trash2 size={20} aria-hidden="true" />,
          "Delete client",
          () =>
            workspace?.open(
              { kind: "action", action: "deleteContact", client },
              "client-menu",
            ),
          true,
        )}
      </ListCard>
    </Overlay>
  );
}

function ServiceRow({
  service: s,
  state,
  thisYear,
  onOpen,
}: {
  service: Receivable;
  state: ServiceState;
  thisYear: number;
  onOpen: () => void;
}) {
  const shown = finished(state) ? s.amount : s.outstanding;
  const hint = `${shortDate(s.serviceDate, thisYear)}${
    s.dueDate ? ` · Due ${shortDate(s.dueDate, thisYear)}` : ""
  }`;
  return (
    <ListRow
      title={s.description}
      hint={hint}
      render={(inner, className) => (
        <button
          type="button"
          id={`service-${s.id}`}
          className={className}
          onClick={onOpen}
        >
          {inner}
        </button>
      )}
      value={
        <span className="cl-svc-end">
          <Amount cents={shown.amount} currency={shown.currency} />
          <ServicePill state={state} />
        </span>
      }
    />
  );
}

/**
 * One client (ADR 0047, the prototype's `clientDetail`): the balance card with what was paid this month,
 * the unpaid services pinned, then Paid and History under one switch. A service opens in a sheet.
 */
export function ClientDetail({
  ledgerId,
  clientId,
  fallback,
  month,
  writable,
}: {
  ledgerId: string;
  clientId: string;
  /** What the list already knows, shown while the client itself loads. */
  fallback: Contact | undefined;
  month: string;
  writable: boolean;
}) {
  const workspace = useClientsWorkspace();
  const blocked = workspace?.blocked ?? false;
  const today = localToday();
  const thisYear = Number(today.slice(0, 4));
  const client = useQuery({
    queryKey: ["contacts", ledgerId, "detail", clientId, month],
    queryFn: ({ signal }) => getClient(ledgerId, clientId, month, signal),
  });
  const services = useInfiniteQuery({
    queryKey: ["receivables", ledgerId, "client", clientId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getServices(ledgerId, clientId, pageParam, signal),
    getNextPageParam: (p, _pages, _param, params) =>
      p.nextCursor && !params.includes(p.nextCursor) ? p.nextCursor : undefined,
  });
  // The Unpaid and Paid lists are whole, so every page of services is fetched.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = services;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const history = useInfiniteQuery({
    queryKey: ["clientHistory", ledgerId, clientId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getHistory(ledgerId, clientId, pageParam, signal),
    getNextPageParam: (p, _pages, _param, params) =>
      p.nextCursor && !params.includes(p.nextCursor) ? p.nextCursor : undefined,
  });
  const [tab, setTab] = useState<"paid" | "history">("paid");
  const [menu, setMenu] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const c = client.data ?? fallback;
  const all = services.data?.pages.flatMap((p) => p.items) ?? [];
  const unpaid = all.filter((s) => !finished(serviceState(s, today)));
  const done = all.filter((s) => finished(serviceState(s, today)));
  const sheetService = all.find((s) => s.id === sheetId);
  // The count is said only once every event is here, so it is never a number that later grows.
  const historyCount =
    history.data && !history.hasNextPage
      ? history.data.pages.reduce((n, page) => n + page.items.length, 0)
      : null;
  const overdue = overdueCount(all, today);
  const logService = () =>
    c && workspace?.open({ kind: "service", client: c }, "log-service");
  const row = (s: Receivable) => (
    <ServiceRow
      key={s.id}
      service={s}
      state={serviceState(s, today)}
      thisYear={thisYear}
      onOpen={() => setSheetId(s.id)}
    />
  );
  if (client.isError && !c)
    return (
      <LoadError
        message="Couldn't load this client."
        onRetry={() => void client.refetch()}
      />
    );
  if (!c)
    return (
      <p className="muted" role="status">
        Loading client…
      </p>
    );
  const owes = c.openBalances.length > 0;
  const contact = [c.email, c.phone].filter(Boolean).join(" · ");
  return (
    <>
      <section className="ui-card cl-card" aria-label={c.name}>
        <div className="cl-card-top">
          <div className="cl-card-main">
            <h2 className="cl-name">
              {c.name}
              {c.archivedAt ? " (archived)" : ""}
            </h2>
            <p className="cl-label">{owes ? "Owes you" : "Settled"}</p>
            <p className="cl-figure">
              <Balances client={c} />
            </p>
            <p className="cl-overdue">
              {overdue > 0
                ? `${overdue} ${overdue === 1 ? "service" : "services"} overdue`
                : " "}
            </p>
          </div>
          <div className="cl-paid">
            <p className="cl-label">{paidInLabel(month)}</p>
            <p className="cl-paid-figure">
              <Amount cents={c.paidThisMonth.base.amount} />
            </p>
          </div>
        </div>
        {contact && <p className="cl-contact">{contact}</p>}
        {c.note && <p className="cl-contact cl-note">{c.note}</p>}
        {writable && (
          <div className="cl-card-actions">
            {owes && (
              <button
                type="button"
                id="record-client-payment"
                className="ui-btn ui-btn-primary"
                disabled={blocked}
                onClick={() =>
                  workspace?.open(
                    { kind: "receipt", client: c },
                    "record-client-payment",
                  )
                }
              >
                <HandCoins size={18} aria-hidden="true" />
                Record payment
              </button>
            )}
            <button
              type="button"
              id="log-service"
              className="ui-btn ui-btn-secondary cl-log"
              disabled={blocked || !!c.archivedAt}
              onClick={logService}
            >
              <Plus size={18} aria-hidden="true" />
              Log service
            </button>
            <button
              type="button"
              id="client-menu"
              className="ui-icon-btn"
              aria-label={`More actions for ${c.name}`}
              onClick={() => setMenu(true)}
            >
              <EllipsisVertical size={20} aria-hidden="true" />
            </button>
          </div>
        )}
      </section>
      {services.isPending ? (
        <p className="muted" role="status">
          Loading services…
        </p>
      ) : services.isError ? (
        <LoadError
          message="Couldn't load services."
          onRetry={() => void services.refetch()}
        />
      ) : all.length === 0 ? (
        <div className="ui-card">
          <EmptyState text="No services yet." />
        </div>
      ) : (
        <>
          {unpaid.length > 0 && (
            <section aria-label="Unpaid services">
              <SectionLabel>Unpaid</SectionLabel>
              <ListCard>{unpaid.map(row)}</ListCard>
            </section>
          )}
          <SegmentedControl
            label="Paid or history"
            value={tab}
            onChange={setTab}
            options={[
              { value: "paid", label: `Paid ${done.length}` },
              {
                value: "history",
                label:
                  historyCount === null ? "History" : `History ${historyCount}`,
              },
            ]}
          />
          {tab === "paid" ? (
            done.length > 0 ? (
              <ListCard>{done.map(row)}</ListCard>
            ) : (
              <div className="ui-card">
                <EmptyState text="Nothing paid yet." />
              </div>
            )
          ) : (
            <section aria-label="Client history">
              {history.isPending ? (
                <p className="muted" role="status">
                  Loading history…
                </p>
              ) : history.isError ? (
                <LoadError
                  message="Couldn't load history."
                  onRetry={() => void history.refetch()}
                />
              ) : (
                <>
                  <ListCard>
                    {history.data?.pages
                      .flatMap((p) => p.items)
                      .map((e) => (
                        <ListRow
                          key={e.id}
                          title={labels[e.action]}
                          hint={[
                            when(e.createdAt),
                            e.after.service.description,
                            e.after.service.writeOffReason,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          value={
                            e.after.payment ? (
                              <span>
                                {e.before?.payment && (
                                  <>
                                    <Amount
                                      cents={e.before.payment.amount.amount}
                                      currency={
                                        e.before.payment.amount.currency
                                      }
                                    />{" "}
                                    →{" "}
                                  </>
                                )}
                                <Amount
                                  cents={e.after.payment.amount.amount}
                                  currency={e.after.payment.amount.currency}
                                />
                              </span>
                            ) : (
                              <Amount
                                cents={e.after.service.amount.amount}
                                currency={e.after.service.amount.currency}
                              />
                            )
                          }
                        />
                      ))}
                  </ListCard>
                  {history.hasNextPage && (
                    <button
                      type="button"
                      className="ui-btn ui-btn-secondary"
                      disabled={history.isFetchingNextPage}
                      onClick={() => void history.fetchNextPage()}
                    >
                      Load more history
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
      {menu && <ClientMenu client={c} onClose={() => setMenu(false)} />}
      {sheetService && (
        <ServiceSheet
          service={sheetService}
          client={c}
          ledgerId={ledgerId}
          writable={writable}
          today={today}
          thisYear={thisYear}
          onClose={() => setSheetId(null)}
        />
      )}
    </>
  );
}
