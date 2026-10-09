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
import { useContext, useEffect, useState } from "react";
import { ActionBar } from "../../components/action-bar";
import { ActionButton } from "../../components/action-button";
import { NativeSelect } from "../../components/native-select";
import { getLedgers } from "../../lib/api";
import { formatTime12 } from "../../lib/time";
import { formatUsd } from "../accounts/money";
import { PrivacyContext } from "../shell/preferences";
import { localToday } from "../transactions/form";
import {
  getHistory,
  getPayments,
  getPeople,
  getPerson,
  getServices,
} from "./api";
import { usePeopleWorkspace } from "./workspace";

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
function Amount({ value }: { value: number }) {
  const hidden = useContext(PrivacyContext);
  return (
    <span className="amount">
      {hidden ? (
        <>
          <span aria-hidden="true">••••</span>
          <span className="sr-only">Amount hidden</span>
        </>
      ) : (
        formatUsd(value)
      )}
    </span>
  );
}
export function PeoplePage() {
  const ledger = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers }).data
      ?.items[0],
    workspace = usePeopleWorkspace();
  const [selected, setSelected] = useState<string | null>(null),
    [status, setStatus] = useState("all"),
    [text, setText] = useState("");
  const people = useInfiniteQuery({
    queryKey: ["contacts", ledger?.id, "list", status, text],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getPeople(ledger?.id as string, status, text, pageParam, signal),
    getNextPageParam: (p, _pages, _param, params) =>
      p.nextCursor && !params.includes(p.nextCursor) ? p.nextCursor : undefined,
    enabled: !!ledger,
  });
  const deletedPersonId = workspace?.deletedPersonId ?? null;
  useEffect(() => {
    if (deletedPersonId)
      setSelected((id) => (id === deletedPersonId ? null : id));
  }, [deletedPersonId]);
  const person = useQuery({
    queryKey: ["contacts", ledger?.id, "detail", selected],
    queryFn: () => getPerson(ledger?.id as string, selected as string),
    enabled: !!ledger && !!selected,
  });
  const services = useInfiniteQuery({
    queryKey: ["receivables", ledger?.id, "person", selected],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getServices(ledger?.id as string, selected as string, pageParam, signal),
    getNextPageParam: (p, _pages, _param, params) =>
      p.nextCursor && !params.includes(p.nextCursor) ? p.nextCursor : undefined,
    enabled: !!ledger && !!selected,
  });
  const history = useInfiniteQuery({
    queryKey: ["peopleHistory", ledger?.id, selected],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getHistory(ledger?.id as string, selected as string, pageParam, signal),
    getNextPageParam: (p, _pages, _param, params) =>
      p.nextCursor && !params.includes(p.nextCursor) ? p.nextCursor : undefined,
    enabled: !!ledger && !!selected,
  });
  const writable = !!ledger && ledger.role !== "viewer",
    disabled = workspace?.blocked ?? false;
  const rows = people.data?.pages.flatMap((p) => p.items) ?? [];
  const editPerson = (p: Contact) =>
    workspace?.open({ kind: "contact", person: p }, `person-${p.id}`);
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">MONEY OWED TO YOU</p>
        <h1>People</h1>
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
            All people
          </button>
          {person.isError ? (
            <p role="alert">
              Could not load this person.{" "}
              <button type="button" onClick={() => void person.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            person.data && (
              <section className="settings-card people-detail">
                <h2>
                  {person.data.name}
                  {person.data.archivedAt ? " (archived)" : ""}
                </h2>
                <p>
                  Open balance <Amount value={person.data.openBalance.amount} />
                </p>
                {person.data.oldestOpenServiceDate && (
                  <p className="muted">
                    Oldest unpaid service: {person.data.oldestOpenServiceDate}
                  </p>
                )}
                {person.data.phone && <p>{person.data.phone}</p>}
                {person.data.email && <p>{person.data.email}</p>}
                {person.data.note && <p>{person.data.note}</p>}
                {writable && (
                  <ActionBar
                    menuLabel={`More actions for ${person.data.name}`}
                    primary={
                      person.data.openBalance.amount > 0
                        ? {
                            key: "pay",
                            id: "record-person-payment",
                            label: `Record payment from ${person.data.name}`,
                            shortLabel: "Record payment",
                            icon: HandCoins,
                            disabled,
                            onSelect: () =>
                              workspace?.open(
                                { kind: "receipt", person: person.data },
                                "record-person-payment",
                              ),
                          }
                        : {
                            key: "log",
                            id: "log-service",
                            label: "Log service",
                            icon: Plus,
                            disabled: disabled || !!person.data.archivedAt,
                            onSelect: () =>
                              workspace?.open(
                                { kind: "service", person: person.data },
                                "log-service",
                              ),
                          }
                    }
                    featured={
                      person.data.openBalance.amount > 0
                        ? {
                            key: "log",
                            id: "log-service",
                            label: "Log service",
                            icon: Plus,
                            disabled: disabled || !!person.data.archivedAt,
                            onSelect: () =>
                              workspace?.open(
                                { kind: "service", person: person.data },
                                "main-content",
                              ),
                          }
                        : undefined
                    }
                    actions={[
                      {
                        key: "edit",
                        label: "Edit person",
                        icon: Pencil,
                        disabled,
                        onSelect: () => editPerson(person.data),
                      },
                      {
                        key: "archive",
                        label: person.data.archivedAt
                          ? "Unarchive person"
                          : "Archive person",
                        icon: person.data.archivedAt ? ArchiveRestore : Archive,
                        disabled,
                        onSelect: () =>
                          workspace?.open(
                            {
                              kind: "action",
                              action: person.data.archivedAt
                                ? "unarchive"
                                : "archive",
                              person: person.data,
                            },
                            "main-content",
                          ),
                      },
                      {
                        key: "delete",
                        label: "Delete person",
                        danger: true,
                        icon: Trash2,
                        disabled,
                        onSelect: () =>
                          workspace?.open(
                            {
                              kind: "action",
                              action: "deleteContact",
                              person: person.data,
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
          <section aria-label="Services" className="people-section">
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
                    No services yet. Log work you have done for this person.
                  </p>
                )}
                <ul className="people-rows" aria-label="Services">
                  {services.data?.pages
                    .flatMap((p) => p.items)
                    .map((s) => (
                      <ServiceRow
                        key={s.id}
                        service={s}
                        ledgerId={ledger.id}
                        person={person.data}
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
          <section aria-label="Person history" className="people-section">
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
                <ul className="people-rows" aria-label="Person history">
                  {history.data?.pages
                    .flatMap((p) => p.items)
                    .map((e) => (
                      <li className="history-row people-event" key={e.id}>
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
                                    />{" "}
                                    →{" "}
                                  </>
                                )}
                                <Amount value={e.after.payment.amount.amount} />
                              </span>
                            ) : (
                              <Amount value={e.after.service.amount.amount} />
                            )}
                          </div>
                        </div>
                        <p className="muted row-meta">
                          {new Date(e.createdAt).toLocaleString()} · service
                          version {e.receivableVersion} · Open after{" "}
                          <Amount value={e.after.service.outstanding.amount} />
                          {e.after.service.writtenOffAmount && (
                            <>
                              {" "}
                              · Waived{" "}
                              <Amount
                                value={e.after.service.writtenOffAmount.amount}
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
          <div className="people-toolbar">
            <label>
              Search people
              <input
                type="search"
                value={text}
                maxLength={200}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <label htmlFor="people-status">
              People status
              <NativeSelect
                id="people-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All people</option>
                <option value="active">Active people</option>
                <option value="archived">Archived people</option>
              </NativeSelect>
            </label>
            {writable && (
              <button
                id="add-person"
                type="button"
                className="button"
                disabled={disabled}
                onClick={() =>
                  workspace?.open({ kind: "contact" }, "add-person")
                }
              >
                Add person
              </button>
            )}
          </div>
          {people.isPending ? (
            <p role="status">Loading people…</p>
          ) : people.isError ? (
            <p role="alert">
              Could not load people.{" "}
              <button type="button" onClick={() => void people.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            <>
              {rows.length === 0 && (
                <section className="settings-card">
                  <h2>
                    {text ? "No matching people" : "Keep track of unpaid work"}
                  </h2>
                  <p>
                    Add a person, log a service, and record payment when it
                    arrives.
                  </p>
                </section>
              )}
              <div className="people-grid">
                {rows.map((p) => (
                  <button
                    id={`person-${p.id}`}
                    type="button"
                    className="settings-card person-card"
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                  >
                    <strong>
                      {p.name}
                      {p.archivedAt ? " (archived)" : ""}
                    </strong>
                    <Amount value={p.openBalance.amount} />
                    <span className="muted">
                      {p.oldestOpenServiceDate
                        ? `Oldest unpaid: ${p.oldestOpenServiceDate}`
                        : "No open services"}
                    </span>
                  </button>
                ))}
              </div>
              {people.hasNextPage && (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={people.isFetchingNextPage}
                  onClick={() => void people.fetchNextPage()}
                >
                  Load more people
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
  person,
  writable,
}: {
  service: Receivable;
  ledgerId: string;
  person: Contact | undefined;
  writable: boolean;
}) {
  const workspace = usePeopleWorkspace(),
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
          <Amount value={s.outstanding.amount} />
        </div>
      </div>
      <p className="muted row-meta">
        Service <Amount value={s.amount.amount} /> · Received{" "}
        <Amount value={s.received.amount} />
        {s.writtenOffAmount && (
          <>
            {" "}
            · Written off <Amount value={s.writtenOffAmount.amount} />
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
                ...(s.status !== "writtenOff" && person
                  ? [
                      {
                        key: "edit",
                        label: "Edit service",
                        icon: Pencil,
                        disabled: blocked,
                        onSelect: () =>
                          workspace?.open(
                            { kind: "service", service: s, person },
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
        <div className="people-payments">
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
                      · <Amount value={p.amount.amount} />
                    </p>
                    {p.transaction.note && <p>{p.transaction.note}</p>}
                    {p.receiptId ? (
                      <>
                        <p className="muted">
                          Part of one payment applied across several services.
                        </p>
                        <div className="people-actions">
                          <ActionButton
                            icon={Pencil}
                            id={`payment-${p.id}`}
                            variant="secondary"
                            disabled={blocked || !person}
                            onClick={() =>
                              person &&
                              workspace?.open(
                                {
                                  kind: "receipt",
                                  person,
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
                      <div className="people-actions">
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
