import type { Transaction } from "@ledgerline/shared";
import { Avatar, IconTile, StatusPill } from "@ledgerline/ui";
import { ArrowLeftRight } from "lucide-react";
import { Amount, BaseNote } from "../../components/amount-text";
import { formatTime12 } from "../../lib/time";
import { TagChips } from "../tags/tag-chips";
import type { ListEntry } from "./list-model";

type Names = {
  account: (id: string) => string;
  category: (id: string | null) => string;
};

/**
 * The words after the title: what it is (left out when the title already says it), then the time and what it
 * belongs to. The account has its own place.
 */
function hintOf(
  row: Transaction,
  names: Names,
  transfer: boolean,
  titleIsCategory: boolean,
) {
  const kind = transfer
    ? "Transfer"
    : row.isSplit
      ? `Split · ${row.splits.length} categories`
      : titleIsCategory
        ? ""
        : names.category(row.categoryId);
  return [
    kind,
    row.time ? formatTime12(row.time) : "",
    row.receivablePaymentId ? "Service payment" : "",
    row.feeTransferId ? "Transfer fee" : "",
    row.tipPaymentId ? "Tip" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One row of the list: a single entry, or the two legs of a transfer as one. A row opens its entry in place. */
export function EntryRow({
  entry,
  names,
  disabled,
  onOpen,
}: {
  entry: ListEntry;
  names: Names;
  disabled: boolean;
  onOpen: (row: Transaction) => void;
}) {
  const paired = entry.kind === "transfer";
  const row = paired ? entry.from : entry.row;
  const legTransfer = !paired && !!row.transferId;
  const title = paired
    ? `${names.account(entry.from.accountId)} → ${names.account(entry.to.accountId)}`
    : legTransfer
      ? `Transfer ${row.amount.amount < 0 ? "from" : "to"} ${names.account(row.accountId)}`
      : row.payee ||
        (row.isSplit ? "Split transaction" : names.category(row.categoryId));
  const titleIsCategory = !paired && !legTransfer && !row.payee && !row.isSplit;
  const hint = hintOf(row, names, paired || legTransfer, titleIsCategory);
  const label = paired
    ? `Transfer from ${names.account(entry.from.accountId)} to ${names.account(entry.to.accountId)}`
    : title;
  const account = paired ? "" : names.account(row.accountId);
  const income = !paired && !legTransfer && row.amount.amount > 0;
  return (
    <button
      type="button"
      id={`transaction-${row.id}`}
      className="ui-row ui-row-press tx-row"
      disabled={disabled}
      aria-label={`Open transaction: ${label}`}
      onClick={() => onOpen(row)}
    >
      {paired || legTransfer ? (
        <IconTile>
          <ArrowLeftRight size={18} />
        </IconTile>
      ) : (
        <Avatar name={title} />
      )}
      <span className="tx-main">
        <span className="tx-text">
          <span className="ui-row-title">{title}</span>
          <span className="ui-row-hint">
            {hint}
            {account && (
              <span className="tx-inline-account">
                {hint && " · "}
                {account}
              </span>
            )}
          </span>
          {row.note && <span className="ui-row-hint tx-note">{row.note}</span>}
        </span>
        <span className="tx-account">{account}</span>
        <TagChips tags={row.tags} />
      </span>
      <span className="ui-row-end">
        <span className={income ? "tx-pos" : undefined}>
          <Amount
            cents={paired ? Math.abs(row.amount.amount) : row.amount.amount}
            currency={row.amount.currency}
            plus={income}
          />
        </span>
        <BaseNote amount={row.amount} baseAmount={row.baseAmount} />
        {row.status === "pending" && (
          <span className="tx-pending">
            <StatusPill tone="neutral">Pending</StatusPill>
          </span>
        )}
      </span>
    </button>
  );
}
