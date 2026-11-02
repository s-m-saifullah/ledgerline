import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { PickRow } from "../../../components/pick-row";
import { formatMoney } from "../../../lib/money";
import { EntryRate } from "../../currencies/entry-rate";
import { CategoryCombo } from "../../transactions/category-combo";
import { amountMinor } from "../../transactions/form";
import { inputFor } from "./fields";
import type { OperationForm } from "./form-context";
import { PaymentRate } from "./payment-rate";

/** The line under a new payment's amount that says what the extra is when it goes over what is owed (ADR 0027). */
export function renderTipNote(form: OperationForm) {
  const { privateMode } = form;
  const { creatingPayment, needsReceived, extra, itemCurrency } = form.derived;
  if (!creatingPayment || needsReceived || !extra || extra.tip <= 0)
    return null;
  return (
    <p role="status" className="ed-note">
      {privateMode
        ? "••••"
        : `This settles ${formatMoney(extra.settle, itemCurrency)}. The extra ${formatMoney(extra.tip, itemCurrency)} is saved as a tip: separate income that does not change what is owed.`}
    </p>
  );
}

/**
 * The receiving account, category, tip and date fields shared by payments and receipts (`OV["pay-service"]`,
 * `OV["payment-edit"]`): an account row and a category in one card, what arrived and the rate when the account
 * uses another currency, and the date, time and note in a fold when recording or flat when correcting.
 */
export function renderPaymentFields(
  form: OperationForm,
  existingAccountId: string | undefined,
  creating: boolean,
) {
  const {
    values,
    setValues,
    accounts,
    categories,
    ledgerId,
    privateMode,
    writable,
  } = form;
  const {
    needsReceived,
    accountCurrency,
    itemCurrency,
    rateSettable,
    tipMinor,
  } = form.derived;
  const input = inputFor(form);
  const money = privateMode ? "password" : "text";
  const tipField =
    creating && needsReceived && accountCurrency
      ? input(
          "tipAmount",
          `Tip (${accountCurrency}, optional)`,
          money,
          false,
          accountCurrency,
          false,
          true,
        )
      : null;
  const when = (
    <>
      {input("date", "Payment date", "date", true)}
      {input("time", "Time (Optional)", "time")}
      {input("note", "Payment note", "text", false, undefined, false, true)}
    </>
  );
  const noIncome =
    writable &&
    categories.data &&
    !categories.data.some((c) => c.kind === "income" && !c.archivedAt);
  return (
    <>
      <div className="ed-card">
        <PickRow
          id="client-account"
          label="Receiving account"
          value={values.accountId}
          options={[
            { value: "", label: "Choose account", short: "Choose" },
            ...(accounts.data ?? [])
              .filter((a) => !a.archivedAt || a.id === existingAccountId)
              .map((a) => ({
                value: a.id,
                label: `${a.name}${a.archivedAt ? " (archived)" : ""}`,
              })),
          ]}
          onChange={(accountId) => setValues((v) => ({ ...v, accountId }))}
        />
        <div className="ed-field">
          <CategoryCombo
            label="Category for the payment"
            categories={categories.data ?? []}
            kind="income"
            value={values.categoryId || null}
            onChange={(id) => setValues((v) => ({ ...v, categoryId: id }))}
          />
        </div>
        {creating && tipMinor > 0 && (
          <div className="ed-field">
            <CategoryCombo
              label="Category for the tip"
              categories={categories.data ?? []}
              kind="income"
              value={values.tipCategoryId || null}
              onChange={(id) => setValues((v) => ({ ...v, tipCategoryId: id }))}
            />
          </div>
        )}
      </div>
      {needsReceived && accountCurrency && (
        <>
          {input(
            "receivedAmount",
            `Amount received (${accountCurrency})`,
            money,
            true,
            accountCurrency,
          )}
          <PaymentRate
            settled={amountMinor(values.amount, itemCurrency)}
            received={amountMinor(values.receivedAmount, accountCurrency)}
            itemCurrency={itemCurrency}
            accountCurrency={accountCurrency}
          />
        </>
      )}
      {rateSettable && accountCurrency && ledgerId && (
        <EntryRate
          ledgerId={ledgerId}
          currency={accountCurrency}
          date={values.date}
          amountMinor={amountMinor(
            needsReceived ? values.receivedAmount : values.amount,
            accountCurrency,
          )}
          manualRate={values.fxRate}
          onManualRate={(rate) => setValues((v) => ({ ...v, fxRate: rate }))}
        />
      )}
      {noIncome && (
        <p className="ed-note">
          There are no income categories yet.{" "}
          <Link to="/categories">Add income categories</Link> first.
        </p>
      )}
      {accounts.data &&
        !accounts.data.some((a) => !a.archivedAt) &&
        creating && <Link to="/accounts">Set up a receiving account</Link>}
      {creating ? (
        <details className="ed-card ed-fold">
          <summary>
            <span className="ui-row-title">
              {tipField ? "Tip, date, time and note" : "Date, time and note"}
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <div className="ed-fold-body">
            {tipField}
            {when}
          </div>
        </details>
      ) : (
        <div className="ed-card">
          <div className="ed-fold-body">{when}</div>
        </div>
      )}
    </>
  );
}
