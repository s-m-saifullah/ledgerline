import { Link } from "@tanstack/react-router";
import { NativeSelect } from "../../../components/native-select";
import { formatMoney } from "../../../lib/money";
import { CategoryPicker } from "../../categories/picker";
import { EntryRate } from "../../currencies/entry-rate";
import { amountMinor } from "../../transactions/form";
import { inputFor } from "./fields";
import type { OperationForm } from "./form-context";
import { PaymentRate } from "./payment-rate";

/** The receiving account, tip, category and date fields shared by payments and receipts. */
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
    frozen,
    allowWrite,
    writable,
  } = form;
  const {
    needsReceived,
    accountCurrency,
    itemCurrency,
    rateSettable,
    extra,
    tipMinor,
  } = form.derived;
  const input = inputFor(form);
  return (
    <>
      <label className="form-field" htmlFor="client-account">
        Receiving account
        <NativeSelect
          id="client-account"
          value={values.accountId}
          onChange={(e) =>
            setValues((v) => ({
              ...v,
              accountId: e.target.value,
            }))
          }
        >
          <option value="">Choose account</option>
          {accounts.data
            ?.filter((a) => !a.archivedAt || a.id === existingAccountId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.archivedAt ? " (archived)" : ""}
              </option>
            ))}
        </NativeSelect>
      </label>
      {needsReceived && accountCurrency && (
        <>
          {input(
            "receivedAmount",
            `Amount received (${accountCurrency})`,
            privateMode ? "password" : "text",
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
      {creating && needsReceived && accountCurrency && (
        <>
          {input(
            "tipAmount",
            `Tip (${accountCurrency}, optional)`,
            privateMode ? "password" : "text",
            false,
            accountCurrency,
          )}
          <p className="form-help">
            Extra money received beyond what is owed. It is saved as its own
            income entry and does not change the balance owed.
          </p>
        </>
      )}
      {creating && !needsReceived && extra && extra.tip > 0 && (
        <p role="status" className="tip-note">
          {privateMode
            ? "••••"
            : `This settles ${formatMoney(extra.settle, itemCurrency)}. The extra ${formatMoney(extra.tip, itemCurrency)} is saved as a tip: separate income that does not change what is owed.`}
        </p>
      )}
      {creating && tipMinor > 0 && (
        <CategoryPicker
          label="Category for the tip"
          categories={categories.data ?? []}
          kind="income"
          value={values.tipCategoryId}
          onChange={(id) =>
            setValues((v) => ({ ...v, tipCategoryId: id ?? "" }))
          }
          disabled={frozen || !allowWrite}
        />
      )}
      <CategoryPicker
        label="Category for the payment"
        categories={categories.data ?? []}
        kind="income"
        value={values.categoryId}
        onChange={(id) => setValues((v) => ({ ...v, categoryId: id ?? "" }))}
        disabled={frozen || !allowWrite}
      />
      {writable &&
        categories.data &&
        !categories.data.some((c) => c.kind === "income" && !c.archivedAt) && (
          <p className="muted">
            There are no income categories yet.{" "}
            <Link to="/categories">Add income categories</Link> first.
          </p>
        )}
      {accounts.data &&
        !accounts.data.some((a) => !a.archivedAt) &&
        creating && <Link to="/accounts">Set up a receiving account</Link>}
      <details className="more-details" open={!creating}>
        <summary>More details: date, time and note</summary>
        {input("date", "Payment date", "date", true)}
        {input("time", "Local time", "time")}
        {input("note", "Payment note")}
      </details>
    </>
  );
}
