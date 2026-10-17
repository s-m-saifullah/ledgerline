import type { Contact, Receivable, ReceivableEvent } from "@ledgerline/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  HandCoins,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ActionBar, useIsPhone } from "../../components/action-bar";
import { ActionButton } from "../../components/action-button";
import { Amount } from "../../components/amount";
import { BackToMore } from "../../components/back-to-more";
import { NativeSelect } from "../../components/native-select";
import { getLedgers } from "../../lib/api";
import { formatTime12, localToday } from "../../lib/time";
import {
  getClient,
  getClients,
  getHistory,
  getPayments,
  getServices,
} from "./api";
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
/** What a client owes: each currency's balance, then its value in dollars at today's rates. */
function Balances({ client }: { client: Contact }) {
  if (!client.openBalances.length) return <Amount value={0} />;
  const foreign = client.openBalances.some((b) => b.currency !== "USD");
  if (!foreign)
    return client.openBalances.map((b) => (
      <Amount key={b.currency} value={b.amount} currency={b.currency} />
    ));
  return (
    <span className="client-balances">
      {client.openBalances.map((b) => (
        <Amount key={b.currency} value={b.amount} currency={b.currency} />
      ))}
      <span className="balance-note muted">
        About <Amount value={client.openBalance.amount} /> at today's rates
        {client.unconvertedCurrencies.length > 0
          ? `, not counting ${client.unconvertedCurrencies.join(", ")} (no rate yet)`
          : ""}
      </span>
    </span>
  );
}
export function ClientsPage() {
  const phone = useIsPhone();
  const ledger = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers }).data
      ?.items[0],
    workspace = useClientsWorkspace();
  const [selected, setSelected] = useState<string | null>(null),
    [status, setStatus] = useState("all"),
    [text, setText] = useState("");
  const clients = useInfiniteQuery({
    queryKey: ["contacts", ledger?.id, "list", status, text],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getClients(ledger?.id as string, status, text, pageParam, signal),
    getNextPageParam: (p, _pages, _param, params) =>
      p.nextCursor && !params.includes(p.nextCursor) ? p.nextCursor : undefined,
    enabled: !!ledger,
  });
  const deletedClientId = workspace?.deletedClientId ?? null;
  useEffect(() => {
    if (deletedClientId)
      setSelected((id) => (id === deletedClientId ? null : id));
  }, [deletedClientId]);
  const client = useQuery({
    queryKey: ["contacts", ledger?.id, "detail", selected],
    queryFn: () => getClient(ledger?.id as string, selected as string),
    enabled: !!ledger && !!selected,
  });
  const services = useInfiniteQuery({
    queryKey: ["receivables", ledger?.id, "client", selected],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getServices(ledger?.id as string, selected as string, pageParam, signal),
    getNextPageParam: (p, _pages, _param, params) =>
      p.nextCursor && !params.includes(p.nextCursor) ? p.nextCursor : undefined,
    enabled: !!ledger && !!selected,
  });
  const history = useInfiniteQuery({
    queryKey: ["clientHistory", ledger?.id, selected],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getHistory(ledger?.id as string, selected as string, pageParam, signal),
    getNextPageParam: (p, _pages, _param, params) =>
      p.nextCursor && !params.includes(p.nextCursor) ? p.nextCursor : undefined,
    enabled: !!ledger && !!selected,
  });
  const writable = !!ledger && ledger.role !== "viewer",
    disabled = workspace?.blocked ?? false;
  const rows = clients.data?.pages.flatMap((p) => p.items) ?? [];
  const editClient = (p: Contact) =>
    workspace?.open({ kind: "contact", client: p }, `client-${p.id}`);
  return (
    <>
      <BackToMore />
      <div className="page-heading">
        <p className="eyebrow">MONEY OWED TO YOU</p>
        <h1>Clients</h1>
        <p className="muted">
          Unpaid services stay separate from income until you receive payment.
        </p>
      </div>
      {!ledger ? (
        <p role="status">Loading your ledger…</p>
      ) : selected ? (
        <>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setSelected(null)}
          >
            All clients
          </button>
          {client.isError ? (
            <p role="alert">
              Could not load this client.{" "}
              <button type="button" onClick={() => void client.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            client.data && (
              <section className="settings-card client-detail">
                <h2>
                  {client.data.name}
                  {client.data.archivedAt ? " (archived)" : ""}
                </h2>
                <p>
                  Open balance <Balances client={client.data} />
                </p>
                {client.data.oldestOpenServiceDate && (
                  <p className="muted">
                    Oldest unpaid service: {client.data.oldestOpenServiceDate}
                  </p>
                )}
                {client.data.phone && <p>{client.data.phone}</p>}
                {client.data.email && <p>{client.data.email}</p>}
                {client.data.note && <p>{client.data.note}</p>}
                {writable && (
                  <ActionBar
                    menuLabel={`More actions for ${client.data.name}`}
                    menuId="client-menu"
                    primary={{
                      key: "log",
                      id: "log-service",
                      label: "Log service",
                      icon: Plus,
                      disabled: disabled || !!client.data.archivedAt,
                      onSelect: () =>
                        workspace?.open(
                          { kind: "service", client: client.data },
                          "log-service",
                        ),
                    }}
                    actions={[
                      ...(client.data.openBalances.length > 0
                        ? [
                            {
                              key: "pay",
                              id: "record-client-payment",
                              label: `Record payment from ${client.data.name}`,
                              shortLabel: "Record payment",
                              icon: HandCoins,
                              disabled,
                              onSelect: () =>
                                workspace?.open(
                                  { kind: "receipt", client: client.data },
                                  phone
                                    ? "client-menu"
                                    : "record-client-payment",
                                ),
                            },
                          ]
                        : []),
                      {
                        key: "edit",
                        label: "Edit client",
                        icon: Pencil,
                        disabled,
                        onSelect: () => editClient(client.data),
                      },
                      {
                        key: "archive",
                        label: client.data.archivedAt
                          ? "Unarchive client"
                          : "Archive client",
                        icon: client.data.archivedAt ? ArchiveRestore : Archive,
                        disabled,
                        onSelect: () =>
                          workspace?.open(
                            {
                              kind: "action",
                              action: client.data.archivedAt
                                ? "unarchive"
                                : "archive",
                              client: client.data,
                            },
                            "main-content",
                          ),
                      },
                      {
                        key: "delete",
                        label: "Delete client",
                        danger: true,
                        icon: Trash2,
                        disabled,
                        onSelect: () =>
                          workspace?.open(
                            {
                              kind: "action",
                              action: "deleteContact",
                              client: client.data,
                            },
                            "main-content",
                          ),
                      },
                    ]}
                  />
                )}
              </section>
            )
          )}
          <section aria-label="Services" className="client-section">
            <h2>Services</h2>
            {services.isPending ? (
              <p role="status">Loading services…</p>
            ) : services.isError ? (
              <p role="alert">
                Could not load services.{" "}
                <button type="button" onClick={() => void services.refetch()}>
                  Try again
                </button>
              </p>
            ) : (
              <>
                {!services.data?.pages.some((p) => p.items.length) && (
                  <p className="muted">
                    No services yet. Log work you have done for this client.
                  </p>
                )}
                <ul className="client-rows" aria-label="Services">
                  {services.data?.pages
                    .flatMap((p) => p.items)
                    .map((s) => (
                      <ServiceRow
                        key={s.id}
                        service={s}
                        ledgerId={ledger.id}
                        client={client.data}
                        writable={writable}
                      />
                    ))}
                </ul>
                {services.hasNextPage && (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={services.isFetchingNextPage}
                    onClick={() => void services.fetchNextPage()}
                  >
                    Load more services
                  </button>
                )}
              </>
            )}
          </section>
          <section aria-label="Client history" className="client-section">
            <h2>History</h2>
            {history.isPending ? (
              <p role="status">Loading history…</p>
            ) : history.isError ? (
              <p role="alert">
                Could not load history.{" "}
                <button type="button" onClick={() => void history.refetch()}>
                  Try again
                </button>
              </p>
            ) : (
              <>
                <ul className="client-rows" aria-label="Client history">
                  {history.data?.pages
                    .flatMap((p) => p.items)
                    .map((e) => (
                      <li className="history-row client-event" key={e.id}>
                        <div className="row-main">
                          <div className="row-text">
                            <h3>{labels[e.action]}</h3>
                            <p>{e.after.service.description}</p>
                          </div>
                          <div className="row-figure">
                            {e.after.payment ? (
                              <span>
                                {e.before?.payment && (
                                  <>
                                    <Amount
                                      value={e.before.payment.amount.amount}
                                      currency={
                                        e.before.payment.amount.currency
                                      }
                                    />{" "}
                                    →{" "}
                                  </>
                                )}
                                <Amount
                                  value={e.after.payment.amount.amount}
                                  currency={e.after.payment.amount.currency}
                                />
                              </span>
                            ) : (
                              <Amount
                                value={e.after.service.amount.amount}
                                currency={e.after.service.amount.currency}
                              />
                            )}
                          </div>
                        </div>
                        <p className="muted row-meta">
                          {new Date(e.createdAt).toLocaleString()} · service
                          version {e.receivableVersion} · Open after{" "}
                          <Amount
                            value={e.after.service.outstanding.amount}
                            currency={e.after.service.outstanding.currency}
                          />
                          {e.after.tip && !e.after.tip.deletedAt && (
                            <>
                              {" "}
                              · Tip{" "}
                              <Amount
                                value={e.after.tip.amount.amount}
                                currency={e.after.tip.amount.currency}
                              />
                            </>
                          )}
                          {e.after.service.writtenOffAmount && (
                            <>
                              {" "}
                              · Waived{" "}
                              <Amount
                                value={e.after.service.writtenOffAmount.amount}
                                currency={
                                  e.after.service.writtenOffAmount.currency
                                }
                              />
                            </>
                          )}
                        </p>
                        {e.after.service.writeOffReason && (
                          <p className="row-meta">
                            {e.after.service.writeOffReason}
                          </p>
                        )}
                      </li>
                    ))}
                </ul>
                {history.hasNextPage && (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={history.isFetchingNextPage}
                    onClick={() => void history.fetchNextPage()}
                  >
                    Load more history
                  </button>
                )}
              </>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="client-toolbar">
            <label>
              Search clients
              <input
                type="search"
                value={text}
                maxLength={200}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label htmlFor="client-status">
              Client status
              <NativeSelect
                id="client-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All clients</option>
                <option value="active">Active clients</option>
                <option value="archived">Archived clients</option>
              </NativeSelect>
            </label>
            {writable && (
              <button
                id="add-client"
                type="button"
                className="button"
                disabled={disabled}
                onClick={() =>
                  workspace?.open({ kind: "contact" }, "add-client")
                }
              >
                Add client
              </button>
            )}
          </div>
          {clients.isPending ? (
            <p role="status">Loading clients…</p>
          ) : clients.isError ? (
            <p role="alert">
              Could not load clients.{" "}
              <button type="button" onClick={() => void clients.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            <>
              {rows.length === 0 && (
                <section className="settings-card">
                  <h2>
                    {text ? "No matching clients" : "Keep track of unpaid work"}
                  </h2>
                  <p>
                    Add a client, log a service, and record payment when it
                    arrives.
                  </p>
                </section>
              )}
              <div className="client-grid">
                {rows.map((p) => (
                  <button
                    id={`client-${p.id}`}
                    type="button"
                    className="settings-card client-card"
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                  >
                    <strong>
                      {p.name}
                      {p.archivedAt ? " (archived)" : ""}
                    </strong>
                    <Balances client={p} />
                    <span className="muted">
                      {p.oldestOpenServiceDate
                        ? `Oldest unpaid: ${p.oldestOpenServiceDate}`
                        : "No open services"}
                    </span>
                  </button>
                ))}
              </div>
              {clients.hasNextPage && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={clients.isFetchingNextPage}
                  onClick={() => void clients.fetchNextPage()}
                >
                  Load more clients
                </button>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
function ServiceRow({
  service: s,
  ledgerId,
  client,
  writable,
}: {
  service: Receivable;
  ledgerId: string;
  client: Contact | undefined;
  writable: boolean;
}) {
  const workspace = useClientsWorkspace(),
    [showPayments, setShowPayments] = useState(false);
  const payments = useInfiniteQuery({
    queryKey: ["receivables", ledgerId, "payments", s.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getPayments(ledgerId, s.id, pageParam, signal),
    getNextPageParam: (p, _pages, _param, params) =>
      p.nextCursor && !params.includes(p.nextCursor) ? p.nextCursor : undefined,
    enabled: showPayments,
  });
  const blocked = workspace?.blocked ?? false,
    overdue = s.outstanding.amount > 0 && s.dueDate && s.dueDate < localToday();
  return (
    <li className="service-row">
      <div className="row-main">
        <div className="row-text">
          <h3>{s.description}</h3>
          <p className="muted">
            {s.serviceDate}
            {s.serviceTime ? ` · ${formatTime12(s.serviceTime)}` : ""} ·{" "}
            {s.status === "partlyPaid"
              ? "Partly paid"
              : s.status === "writtenOff"
                ? "Written off"
                : s.status === "paid"
                  ? "Paid"
                  : "Unpaid"}
            {s.dueDate ? ` · Due ${s.dueDate}` : ""}
            {overdue ? " · Overdue" : ""}
          </p>
        </div>
        <div className="row-figure">
          <span className="sr-only">Outstanding</span>
          <Amount
            value={s.outstanding.amount}
            currency={s.outstanding.currency}
          />
        </div>
      </div>
      <p className="muted row-meta">
        Service <Amount value={s.amount.amount} currency={s.amount.currency} />{" "}
        · Received{" "}
        <Amount value={s.received.amount} currency={s.received.currency} />
        {s.writtenOffAmount && (
          <>
            {" "}
            · Written off{" "}
            <Amount
              value={s.writtenOffAmount.amount}
              currency={s.writtenOffAmount.currency}
            />
          </>
        )}
      </p>
      <ActionBar
        menuLabel={`More actions for ${s.description}`}
        primary={
          writable && s.outstanding.amount > 0
            ? {
                key: "pay",
                id: `pay-${s.id}`,
                label: "Record payment",
                icon: HandCoins,
                disabled: blocked,
                onSelect: () =>
                  workspace?.open(
                    { kind: "payment", service: s },
                    `pay-${s.id}`,
                  ),
              }
            : undefined
        }
        actions={
          writable
            ? [
                ...(s.status !== "writtenOff" && client
                  ? [
                      {
                        key: "edit",
                        label: "Edit service",
                        icon: Pencil,
                        disabled: blocked,
                        onSelect: () =>
                          workspace?.open(
                            { kind: "service", service: s, client },
                            "main-content",
                          ),
                      },
                    ]
                  : []),
                ...(s.status !== "paid"
                  ? [
                      {
                        key: "writeoff",
                        label:
                          s.status === "writtenOff"
                            ? "Reopen service"
                            : "Write off remainder",
                        icon:
                          s.status === "writtenOff" ? RotateCcw : CircleSlash,
                        disabled: blocked,
                        onSelect: () =>
                          workspace?.open(
                            {
                              kind: "action",
                              action:
                                s.status === "writtenOff"
                                  ? "reopen"
                                  : "writeOff",
                              service: s,
                            },
                            "main-content",
                          ),
                      },
                    ]
                  : []),
                {
                  key: "delete",
                  label: "Delete service",
                  danger: true,
                  icon: Trash2,
                  disabled: blocked,
                  onSelect: () =>
                    workspace?.open(
                      { kind: "action", action: "deleteService", service: s },
                      "main-content",
                    ),
                },
              ]
            : []
        }
        extra={{
          key: "payments",
          label: showPayments ? "Hide payments" : "Show payments",
          icon: showPayments ? ChevronUp : ChevronDown,
          onSelect: () => setShowPayments(!showPayments),
        }}
      />
      {showPayments && (
        <div className="client-payments">
          {payments.isPending ? (
            <p role="status">Loading payments…</p>
          ) : payments.isError ? (
            <p role="alert">
              Could not load payments.{" "}
              <button type="button" onClick={() => void payments.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            <>
              {!payments.data?.pages.some((p) => p.items.length) && (
                <p className="muted">No received payments.</p>
              )}
              {payments.data?.pages
                .flatMap((p) => p.items)
                .map((p) => (
                  <article key={p.id}>
                    <p>
                      {p.transaction.date}
                      {p.transaction.time
                        ? ` · ${formatTime12(p.transaction.time)}`
                        : ""}{" "}
                      ·{" "}
                      <Amount
                        value={p.amount.amount}
                        currency={p.amount.currency}
                      />
                    </p>
                    {p.transaction.note && <p>{p.transaction.note}</p>}
                    {p.tip && !p.tip.deletedAt && (
                      <p className="muted">
                        Tip{" "}
                        <Amount
                          value={p.tip.amount.amount}
                          currency={p.tip.amount.currency}
                        />{" "}
                        (separate income, not part of the balance)
                      </p>
                    )}
                    {p.receiptId ? (
                      <>
                        <p className="muted">
                          Part of one payment applied across several services.
                        </p>
                        <div className="client-actions">
                          <ActionButton
                            icon={Pencil}
                            id={`payment-${p.id}`}
                            variant="secondary"
                            disabled={blocked || !client}
                            onClick={() =>
                              client &&
                              workspace?.open(
                                {
                                  kind: "receipt",
                                  client,
                                  receiptId: p.receiptId as string,
                                },
                                `payment-${p.id}`,
                              )
                            }
                          >
                            {writable ? "Edit receipt" : "Receipt details"}
                          </ActionButton>
                          {writable && s.status !== "writtenOff" && (
                            <ActionButton
                              icon={Trash2}
                              variant="secondary"
                              danger
                              disabled={blocked}
                              onClick={() =>
                                workspace?.open(
                                  {
                                    kind: "action",
                                    action: "deleteReceipt",
                                    receiptId: p.receiptId as string,
                                  },
                                  "main-content",
                                )
                              }
                            >
                              Delete receipt
                            </ActionButton>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="client-actions">
                        <ActionButton
                          icon={Pencil}
                          id={`payment-${p.id}`}
                          variant="secondary"
                          disabled={blocked}
                          onClick={() =>
                            workspace?.open(
                              { kind: "payment", service: s, payment: p },
                              `payment-${p.id}`,
                            )
                          }
                        >
                          {writable ? "Edit payment" : "Payment details"}
                        </ActionButton>
                        {writable && s.status !== "writtenOff" && (
                          <ActionButton
                            icon={Trash2}
                            variant="secondary"
                            danger
                            disabled={blocked}
                            onClick={() =>
                              workspace?.open(
                                {
                                  kind: "action",
                                  action: "deletePayment",
                                  service: s,
                                  payment: p,
                                },
                                "main-content",
                              )
                            }
                          >
                            Delete payment
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              {payments.hasNextPage && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={payments.isFetchingNextPage}
                  onClick={() => void payments.fetchNextPage()}
                >
                  Load more payments
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
