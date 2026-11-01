import type { Contact, Receivable } from "@ledgerline/shared";
import {
  IconTile,
  ListCard,
  ListRow,
  SectionLabel,
  StatusPill,
} from "@ledgerline/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  HandCoins,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Amount } from "../../components/amount-text";
import { LoadError } from "../../components/load-error";
import { Overlay } from "../../components/overlay";
import { formatTime12 } from "../../lib/time";
import { getPayments } from "./api";
import { type ServiceState, serviceState, shortDate } from "./model";
import { useClientsWorkspace } from "./workspace";

const PILLS: Record<
  ServiceState,
  { label: string; tone: "accent" | "danger" | "neutral" }
> = {
  overdue: { label: "Overdue", tone: "danger" },
  unpaid: { label: "Unpaid", tone: "neutral" },
  partly: { label: "Partly paid", tone: "accent" },
  paid: { label: "Paid", tone: "accent" },
  written: { label: "Written off", tone: "neutral" },
};
export function ServicePill({ state }: { state: ServiceState }) {
  const { label, tone } = PILLS[state];
  return <StatusPill tone={tone}>{label}</StatusPill>;
}

/** A row that does something when pressed, in the sheet's list of actions. */
function ActionRow({
  icon,
  title,
  onPick,
  disabled,
  danger = false,
}: {
  icon: ReactNode;
  title: string;
  onPick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className="ui-row ui-row-press"
      disabled={disabled}
      onClick={onPick}
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
}

/**
 * One service in a sheet (ADR 0047): what it came to and what was received, its payments (each can be
 * edited or deleted), and the actions that used to sit in a bar on every row.
 */
export function ServiceSheet({
  service: s,
  client,
  ledgerId,
  writable,
  today,
  thisYear,
  onClose,
}: {
  service: Receivable;
  client: Contact | undefined;
  ledgerId: string;
  writable: boolean;
  today: string;
  thisYear: number;
  onClose: () => void;
}) {
  const workspace = useClientsWorkspace();
  const blocked = workspace?.blocked ?? false;
  const trigger = `service-${s.id}`;
  const state = serviceState(s, today);
  const payments = useInfiniteQuery({
    queryKey: ["receivables", ledgerId, "payments", s.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getPayments(ledgerId, s.id, pageParam, signal),
    getNextPageParam: (p, _pages, _param, params) =>
      p.nextCursor && !params.includes(p.nextCursor) ? p.nextCursor : undefined,
  });
  // Close this sheet, then ask the editor for the action; focus returns to the service's row.
  const pick = (run: () => void) => () => {
    onClose();
    run();
  };
  const hint = `${shortDate(s.serviceDate, thisYear)}${
    s.serviceTime ? ` · ${formatTime12(s.serviceTime)}` : ""
  }${s.dueDate ? ` · Due ${shortDate(s.dueDate, thisYear)}` : ""}`;
  const rows = payments.data?.pages.flatMap((p) => p.items) ?? [];
  const canChange = writable && s.status !== "writtenOff";
  return (
    <Overlay
      open
      title={s.description}
      busy={false}
      onDismiss={onClose}
      returnFocusId={trigger}
      fallbackFocusId="main-content"
    >
      <div className="cl-sheet">
        <ListCard>
          <ListRow
            title="Service"
            hint={hint}
            value={
              <span className="cl-svc-end">
                <Amount cents={s.amount.amount} currency={s.amount.currency} />
                <ServicePill state={state} />
              </span>
            }
          />
          {s.received.amount > 0 && (
            <ListRow
              title="Received"
              value={
                <Amount
                  cents={s.received.amount}
                  currency={s.received.currency}
                />
              }
            />
          )}
          {s.writtenOffAmount && (
            <ListRow
              title="Written off"
              value={
                <Amount
                  cents={s.writtenOffAmount.amount}
                  currency={s.writtenOffAmount.currency}
                />
              }
            />
          )}
        </ListCard>
        {payments.isPending ? (
          <p className="muted" role="status">
            Loading payments…
          </p>
        ) : payments.isError ? (
          <LoadError
            message="Couldn't load payments."
            onRetry={() => void payments.refetch()}
          />
        ) : (
          <section aria-label="Payments">
            <SectionLabel>Payments</SectionLabel>
            {rows.length === 0 ? (
              <p className="muted cl-none">No received payments.</p>
            ) : (
              <ListCard>
                {rows.map((p) => (
                  <article key={p.id} className="ui-row ui-row-static cl-pay">
                    <span className="ui-row-main">
                      <span className="ui-row-title">
                        {shortDate(p.transaction.date, thisYear)}
                        {p.transaction.time
                          ? ` · ${formatTime12(p.transaction.time)}`
                          : ""}{" "}
                        ·{" "}
                        <Amount
                          cents={p.amount.amount}
                          currency={p.amount.currency}
                        />
                      </span>
                      {p.transaction.note && (
                        <span className="ui-row-hint">
                          {p.transaction.note}
                        </span>
                      )}
                      {p.tip && !p.tip.deletedAt && (
                        <span className="ui-row-hint">
                          Tip{" "}
                          <Amount
                            cents={p.tip.amount.amount}
                            currency={p.tip.amount.currency}
                          />
                          , separate income
                        </span>
                      )}
                      {p.receiptId && (
                        <span className="ui-row-hint">
                          Part of one payment across several services
                        </span>
                      )}
                    </span>
                    <span className="cl-pay-actions">
                      <button
                        type="button"
                        id={`payment-${p.id}`}
                        className="ui-btn ui-btn-text"
                        disabled={blocked || (!!p.receiptId && !client)}
                        onClick={pick(() =>
                          p.receiptId
                            ? client &&
                              workspace?.open(
                                {
                                  kind: "receipt",
                                  client,
                                  receiptId: p.receiptId,
                                },
                                trigger,
                              )
                            : workspace?.open(
                                { kind: "payment", service: s, payment: p },
                                trigger,
                              ),
                        )}
                      >
                        {p.receiptId
                          ? writable
                            ? "Edit receipt"
                            : "Receipt details"
                          : writable
                            ? "Edit payment"
                            : "Payment details"}
                      </button>
                      {canChange && (
                        <button
                          type="button"
                          className="ui-btn ui-btn-text cl-danger"
                          disabled={blocked}
                          onClick={pick(() =>
                            workspace?.open(
                              p.receiptId
                                ? {
                                    kind: "action",
                                    action: "deleteReceipt",
                                    receiptId: p.receiptId,
                                  }
                                : {
                                    kind: "action",
                                    action: "deletePayment",
                                    service: s,
                                    payment: p,
                                  },
                              trigger,
                            ),
                          )}
                        >
                          {p.receiptId ? "Delete receipt" : "Delete payment"}
                        </button>
                      )}
                    </span>
                  </article>
                ))}
              </ListCard>
            )}
            {payments.hasNextPage && (
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                disabled={payments.isFetchingNextPage}
                onClick={() => void payments.fetchNextPage()}
              >
                Load more payments
              </button>
            )}
          </section>
        )}
        {writable && (
          <ListCard>
            {s.outstanding.amount > 0 && s.status !== "writtenOff" && (
              <ActionRow
                icon={<HandCoins size={20} aria-hidden="true" />}
                title="Record payment"
                disabled={blocked}
                onPick={pick(() =>
                  workspace?.open({ kind: "payment", service: s }, trigger),
                )}
              />
            )}
            {s.status !== "writtenOff" && client && (
              <ActionRow
                icon={<Pencil size={20} aria-hidden="true" />}
                title="Edit service"
                disabled={blocked}
                onPick={pick(() =>
                  workspace?.open(
                    { kind: "service", service: s, client },
                    trigger,
                  ),
                )}
              />
            )}
            {s.status === "writtenOff" ? (
              <ActionRow
                icon={<RefreshCw size={20} aria-hidden="true" />}
                title="Reopen service"
                disabled={blocked}
                onPick={pick(() =>
                  workspace?.open(
                    { kind: "action", action: "reopen", service: s },
                    trigger,
                  ),
                )}
              />
            ) : (
              s.status !== "paid" && (
                <ActionRow
                  icon={<CircleAlert size={20} aria-hidden="true" />}
                  title="Write off remainder"
                  disabled={blocked}
                  onPick={pick(() =>
                    workspace?.open(
                      { kind: "action", action: "writeOff", service: s },
                      trigger,
                    ),
                  )}
                />
              )
            )}
            <ActionRow
              danger
              icon={<Trash2 size={20} aria-hidden="true" />}
              title="Delete service"
              disabled={blocked}
              onPick={pick(() =>
                workspace?.open(
                  { kind: "action", action: "deleteService", service: s },
                  trigger,
                ),
              )}
            />
          </ListCard>
        )}
      </div>
    </Overlay>
  );
}
