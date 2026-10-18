import { currencyDigits } from "@ledgerline/shared";
import { NativeSelect } from "../../../components/native-select";
import { decimalFromCents, formatMoney } from "../../../lib/money";
import { HourlyHelper } from "../hourly-helper";
import { inputFor } from "./fields";
import type { OperationForm } from "./form-context";
import { renderPaymentFields } from "./payment-fields";
import { ReceiptPreview } from "./receipt-preview";
import { type ClientOperation, owedInCurrency } from "./types";

type Kind<K extends ClientOperation["kind"]> = Extract<
  ClientOperation,
  { kind: K }
>;

/** Add or edit a client. */
export function renderContactFields(form: OperationForm) {
  const input = inputFor(form);
  return (
    <>
      {input("name", "Name", "text", true)}
      {input("phone", "Phone")}
      {input("email", "Email", "email")}
      {input("note", "Note")}
    </>
  );
}
/** Log or edit a service. */
export function renderServiceFields(form: OperationForm, op: Kind<"service">) {
  const {
    values,
    setValues,
    frozen,
    allowWrite,
    privateMode,
    clients,
    currencies,
  } = form;
  const input = inputFor(form);
  return (
    <>
      <p>
        Client: {op.client.name}
        {op.client.archivedAt ? " (archived)" : ""}
      </p>
      {op.service && (
        <label className="form-field" htmlFor="client-picker">
          Client
          <NativeSelect
            id="client-picker"
            value={values.contactId}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                contactId: e.target.value,
              }))
            }
          >
            {(clients.data ?? [op.client])
              .filter((p) => !p.archivedAt || p.id === op.client.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.archivedAt ? " (archived)" : ""}
                </option>
              ))}
          </NativeSelect>
        </label>
      )}
      {input("description", "Description", "text", true)}
      {input("serviceDate", "Service date", "date", true)}
      {input("serviceTime", "Service time (optional)", "time")}
      {input("dueDate", "Due date", "date")}
      {currencies.length > 1 && (
        <label className="form-field" htmlFor="client-currency">
          Currency
          <NativeSelect
            id="client-currency"
            value={values.currency}
            disabled={!!op.service && op.service.received.amount > 0}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                currency: e.target.value,
              }))
            }
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </NativeSelect>
          {!!op.service && op.service.received.amount > 0 && (
            <span className="form-help">
              It stays {op.service.amount.currency}, the currency payments were
              recorded in.
            </span>
          )}
        </label>
      )}
      {input(
        "amount",
        `Service amount (${values.currency})`,
        privateMode ? "password" : "text",
        true,
        values.currency,
      )}
      <HourlyHelper
        currency={values.currency}
        secret={privateMode}
        disabled={frozen || !allowWrite}
        descriptionBlank={!values.description.trim()}
        onUse={(amount, description) =>
          setValues((v) => ({
            ...v,
            amount,
            ...(description ? { description } : {}),
          }))
        }
      />
    </>
  );
}
/** Record or edit one payment. */
export function renderPaymentOperation(
  form: OperationForm,
  op: Kind<"payment">,
) {
  const { privateMode } = form;
  const { itemCurrency } = form.derived;
  const input = inputFor(form);
  return (
    <>
      {op.client && <p>Client: {op.client.name}</p>}
      <p>{op.service.description}</p>
      {op.service.status === "writtenOff" && (
        <p className="muted">
          Reopen this service in Clients before correcting its payments.
        </p>
      )}
      <p>
        Outstanding:{" "}
        {privateMode
          ? "••••"
          : formatMoney(
              op.service.outstanding.amount,
              op.service.outstanding.currency,
            )}
      </p>
      {input(
        "amount",
        `Payment amount (${itemCurrency})`,
        privateMode ? "password" : "text",
        true,
        itemCurrency,
      )}
      {op.payment?.tip && !op.payment.tip.deletedAt && (
        <p className="muted">
          This payment came with a tip. Change the tip from Transactions.
        </p>
      )}
      {renderPaymentFields(
        form,

        op.payment?.transaction.accountId,
        !op.payment,
      )}
    </>
  );
}
/** Record or edit a receipt that pays a client's oldest services first. */
export function renderReceiptOperation(
  form: OperationForm,
  op: Kind<"receipt">,
) {
  const { values, setValues, frozen, privateMode, preview, previewCents } =
    form;
  const input = inputFor(form);
  return (
    <>
      <p>Client: {op.client.name}</p>
      {op.receipt ? (
        <>
          <p>
            Receipt total:{" "}
            {privateMode
              ? "••••"
              : formatMoney(
                  op.receipt.amount.amount,
                  op.receipt.amount.currency,
                )}
            , split across {op.receipt.payments.length} services.
          </p>
          <p className="muted">
            Changes to the account, category, date, time or note apply to every
            payment in this receipt.
          </p>
        </>
      ) : (
        <>
          {op.client.openBalances.length > 1 && (
            <label className="form-field" htmlFor="client-receipt-currency">
              Currency being paid
              <NativeSelect
                id="client-receipt-currency"
                value={values.receiptCurrency}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    receiptCurrency: e.target.value,
                    amount: "",
                    receivedAmount: "",
                    fxRate: "",
                  }))
                }
              >
                {op.client.openBalances.map((b) => (
                  <option key={b.currency} value={b.currency}>
                    {b.currency}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
          <p>
            Open balance:{" "}
            {privateMode
              ? "••••"
              : formatMoney(
                  owedInCurrency(op.client, values.receiptCurrency),
                  values.receiptCurrency,
                )}
          </p>
          {input(
            "amount",
            `Payment amount (${values.receiptCurrency})`,
            privateMode ? "password" : "text",
            true,
            values.receiptCurrency,
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={frozen}
            onClick={() =>
              setValues((v) => ({
                ...v,
                amount: decimalFromCents(
                  owedInCurrency(op.client, v.receiptCurrency),
                  currencyDigits(v.receiptCurrency),
                ),
              }))
            }
          >
            Pay full balance
          </button>
          <ReceiptPreview
            currency={values.receiptCurrency}
            query={preview}
            hasAmount={previewCents !== null}
            hidden={privateMode}
          />
        </>
      )}
      {op.receipt?.payments.some((p) => p.tip && !p.tip.deletedAt) && (
        <p className="muted">
          This receipt came with a tip. Change the tip from Transactions.
        </p>
      )}
      {renderPaymentFields(
        form,

        op.receipt?.payments[0]?.transaction.accountId,
        !op.receipt,
      )}
    </>
  );
}
/** The confirmation text (and write-off reason) of a delete, restore, archive or write-off. */
export function renderActionOperation(form: OperationForm, op: Kind<"action">) {
  const input = inputFor(form);
  return (
    <>
      <p>
        {op.action === "deleteReceipt"
          ? "Delete this receipt: every payment it created, its linked income entries and any tip that came with it are removed together."
          : op.action === "restoreReceipt"
            ? "Restore the whole receipt with the same payments, income entries and tip."
            : op.action === "deletePayment"
              ? "Delete the payment, its linked income and any tip that came with it together."
              : op.action === "writeOff"
                ? "Waive only the unpaid remainder. Received income stays in place."
                : op.action === "reopen"
                  ? "Return the waived remainder to money owed."
                  : op.action === "deleteContact"
                    ? "Delete this client only after all their services are deleted. Archive to retain accessible history."
                    : op.action === "deleteService"
                      ? "Delete this service only after its payments are deleted."
                      : "Confirm this action using the loaded version."}
      </p>
      {op.action === "writeOff" && input("reason", "Write-off reason")}
    </>
  );
}
