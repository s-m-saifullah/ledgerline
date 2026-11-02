import { currencyDigits } from "@ledgerline/shared";
import { Avatar, ListCard, ListRow } from "@ledgerline/ui";
import { EntryAmount } from "../../../components/entry-amount";
import { PickRow } from "../../../components/pick-row";
import { decimalFromCents, formatMoney } from "../../../lib/money";
import { HourlyHelper } from "../hourly-helper";
import { inputFor } from "./fields";
import type { OperationForm } from "./form-context";
import { askText } from "./labels";
import { renderPaymentFields, renderTipNote } from "./payment-fields";
import { ReceiptPreview } from "./receipt-preview";
import { type ClientOperation, owedInCurrency } from "./types";

type Kind<K extends ClientOperation["kind"]> = Extract<
  ClientOperation,
  { kind: K }
>;

/** The big amount of a payment: the entry sheet's field, with the code beside it (`OV["pay-service"]`). */
function bigAmount(form: OperationForm, label: string, currency: string) {
  const { values, setValues } = form;
  return (
    <EntryAmount
      id="client-amount"
      label={label}
      currency={currency}
      invalid={false}
      describedBy={undefined}
      inputProps={{
        value: values.amount,
        maxLength: 30,
        onChange: (e) => setValues((v) => ({ ...v, amount: e.target.value })),
      }}
    />
  );
}

/** Add or edit a client (`OV["client-form"]`). */
export function renderContactFields(form: OperationForm) {
  const input = inputFor(form);
  return (
    <>
      {input("name", "Name", "text", true)}
      {input("email", "Email", "email")}
      {input("phone", "Phone")}
      {input("note", "Note", "text", false, undefined, true)}
    </>
  );
}
/** Log or edit a service (`OV.service`). */
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
  const paid = !!op.service && op.service.received.amount > 0;
  return (
    <>
      <p className="ed-note">
        Client: {op.client.name}
        {op.client.archivedAt ? " (archived)" : ""}
      </p>
      {input("description", "Description", "text", true)}
      <div className="ed-card">
        {input("serviceDate", "Service date", "date", true)}
        {input("serviceTime", "Time (Optional)", "time")}
        {input("dueDate", "Due date (Optional)", "date")}
        {currencies.length > 1 && (
          <PickRow
            id="client-currency"
            label="Currency"
            value={values.currency}
            disabled={paid}
            options={currencies.map((code) => ({ value: code, label: code }))}
            onChange={(currency) => setValues((v) => ({ ...v, currency }))}
          />
        )}
      </div>
      {currencies.length > 1 && op.service && paid && (
        <p className="ed-note">
          It stays {op.service.amount.currency}, the currency payments were
          recorded in.
        </p>
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
      {op.service && (
        <div className="ed-card">
          <PickRow
            id="client-picker"
            label="Move to another client"
            value={values.contactId}
            options={(clients.data ?? [op.client])
              .filter((p) => !p.archivedAt || p.id === op.client.id)
              .map((p) => ({
                value: p.id,
                label: `${p.name}${p.archivedAt ? " (archived)" : ""}`,
              }))}
            onChange={(contactId) => setValues((v) => ({ ...v, contactId }))}
          />
        </div>
      )}
    </>
  );
}
/** Record or edit one payment (`OV["pay-service"]`, `OV["payment-edit"]`). */
export function renderPaymentOperation(
  form: OperationForm,
  op: Kind<"payment">,
) {
  const { itemCurrency } = form.derived;
  const mask = (cents: number, currency: string) =>
    form.privateMode ? "••••" : formatMoney(cents, currency);
  return (
    <>
      <ListCard>
        <ListRow
          title={op.service.description}
          {...(op.client ? { hint: `Client: ${op.client.name}` } : {})}
          {...(op.payment
            ? {}
            : {
                value: <span className="ed-quiet">Outstanding</span>,
                valueHint: mask(
                  op.service.outstanding.amount,
                  op.service.outstanding.currency,
                ),
              })}
        />
      </ListCard>
      {op.service.status === "writtenOff" && (
        <p className="ed-note">
          Reopen this service in Clients before correcting its payments.
        </p>
      )}
      {bigAmount(form, `Payment amount (${itemCurrency})`, itemCurrency)}
      {op.payment?.tip && !op.payment.tip.deletedAt && (
        <p className="ed-note">
          This payment came with a tip. Change the tip from Transactions.
        </p>
      )}
      {renderTipNote(form)}
      {renderPaymentFields(
        form,
        op.payment?.transaction.accountId,
        !op.payment,
      )}
    </>
  );
}
/** Record or edit a receipt that pays a client's oldest services first (`OV.receive`, `OV["receipt-edit"]`). */
export function renderReceiptOperation(
  form: OperationForm,
  op: Kind<"receipt">,
) {
  const { values, setValues, frozen, privateMode, preview, previewCents } =
    form;
  const mask = (cents: number, currency: string) =>
    privateMode ? "••••" : formatMoney(cents, currency);
  return (
    <>
      {op.receipt ? (
        <>
          <p className="ed-note">
            Receipt total{" "}
            {mask(op.receipt.amount.amount, op.receipt.amount.currency)}, split
            across {op.receipt.payments.length} services. Changes apply to every
            payment in it.
          </p>
          {op.receipt.payments.some((p) => p.tip && !p.tip.deletedAt) && (
            <p className="ed-note">
              This receipt came with a tip. Change the tip from Transactions.
            </p>
          )}
        </>
      ) : (
        <>
          <ListCard>
            <ListRow
              lead={<Avatar name={op.client.name} />}
              title={op.client.name}
              hint={`Open balance ${mask(
                owedInCurrency(op.client, values.receiptCurrency),
                values.receiptCurrency,
              )}`}
            />
          </ListCard>
          {op.client.openBalances.length > 1 && (
            <div className="ed-card">
              <PickRow
                id="client-receipt-currency"
                label="Currency being paid"
                value={values.receiptCurrency}
                options={op.client.openBalances.map((b) => ({
                  value: b.currency,
                  label: b.currency,
                }))}
                onChange={(receiptCurrency) =>
                  setValues((v) => ({
                    ...v,
                    receiptCurrency,
                    amount: "",
                    receivedAmount: "",
                    fxRate: "",
                  }))
                }
              />
            </div>
          )}
          {bigAmount(
            form,
            `Payment amount (${values.receiptCurrency})`,
            values.receiptCurrency,
          )}
          <button
            type="button"
            className="ui-btn ui-btn-text ed-full-balance"
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
          {renderTipNote(form)}
          <ReceiptPreview
            currency={values.receiptCurrency}
            query={preview}
            hasAmount={previewCents !== null}
            hidden={privateMode}
          />
        </>
      )}
      {renderPaymentFields(
        form,
        op.receipt?.payments[0]?.transaction.accountId,
        !op.receipt,
      )}
      {op.receipt && (
        <p className="ed-note">
          To change the amount, delete the receipt and enter it again.
        </p>
      )}
    </>
  );
}
/** The sentence of a question, and the write-off reason (`OV.confirm`). */
export function renderActionOperation(form: OperationForm, op: Kind<"action">) {
  const input = inputFor(form);
  return (
    <>
      <p>{askText[op.action]}</p>
      {op.action === "writeOff" && input("reason", "Write-off reason")}
    </>
  );
}
