import {
  type Account,
  type Contact,
  currencyDigits,
  type LoanBalance,
  type LoanMove,
  parseMinorUnits,
} from "@ledgerline/shared";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AmountInput } from "../../components/amount-input";
import { DateTimeInput } from "../../components/date-time-input";
import { EditorDialog } from "../../components/editor-dialog";
import { NativeSelect } from "../../components/native-select";
import { ApiError } from "../../lib/api";
import { getCategories } from "../categories/api";
import { CategoryPicker } from "../categories/picker";
import { useBaseValues } from "../currencies/base-value";
import { getActiveAccounts } from "../transactions/api";
import { localToday } from "../transactions/form";
import { Amount } from "./amount";
import { type LoanAction, prepareLoanWrite } from "./loans-api";

const heading = (mode: LoanAction, name: string, owedToYou: boolean) =>
  ({
    lend: [
      `Lend money to ${name}`,
      `The money leaves the account you choose and is recorded as owed by ${name}. It is a transfer, not spending.`,
    ],
    borrow: [
      `Borrow money from ${name}`,
      `The money enters the account you choose and is recorded as owed to ${name}. It is a transfer, not income.`,
    ],
    repay: [
      "Record a repayment",
      owedToYou
        ? `${name} pays you back into the account you choose.`
        : `You pay ${name} back from the account you choose.`,
    ],
    forgive: [
      "Forgive what is left",
      owedToYou
        ? `You give up what ${name} owes you. It is recorded as an expense in the category you choose.`
        : `${name} gives up what you owe. It is recorded as income in the category you choose.`,
    ],
    opening: [
      "Add an existing loan",
      "Record money that was already lent or borrowed before you used Ledgerline. Nothing changes in any of your accounts.",
    ],
  })[mode] as [string, string];

/** Lend, borrow, repay, forgive or add an existing loan (ADR 0030): one form, five actions. */
export function LoanDialog({
  ledgerId,
  client,
  loans,
  mode,
  returnFocusId,
  onClose,
  onSaved,
}: {
  ledgerId: string;
  client: Contact;
  loans: LoanBalance[];
  mode: LoanAction;
  returnFocusId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const values = useBaseValues(ledgerId);
  const open = loans.filter((loan) => loan.balance.amount !== 0);
  const [currency, setCurrency] = useState(
    mode === "repay" || mode === "forgive"
      ? (open[0]?.currency ?? values.baseCurrency)
      : values.baseCurrency,
  );
  const loan = loans.find((row) => row.currency === currency);
  const balance = loan?.balance.amount ?? 0;
  const owedToYou = balance > 0;
  const moves = mode === "lend" || mode === "borrow" || mode === "repay";
  const accounts = useQuery({
    queryKey: ["accounts", ledgerId, "active-own"],
    queryFn: ({ signal }) => getActiveAccounts(ledgerId, signal),
    enabled: moves,
  });
  const categories = useQuery({
    queryKey: ["categories", ledgerId, "loan-forgive"],
    queryFn: ({ signal }) => getCategories(ledgerId, signal),
    enabled: mode === "forgive",
  });
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"owedToMe" | "owedByMe">(
    "owedToMe",
  );
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(localToday());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{
    sig: string;
    run: ReturnType<typeof prepareLoanWrite>;
  } | null>(null);
  const [title, description] = heading(mode, client.name, owedToYou);
  // Lend and borrow take their currency from the account; repay is limited to the account's too.
  const usable = (accounts.data ?? []).filter(
    (account: Account) =>
      mode === "lend" || mode === "borrow" || account.currency === currency,
  );
  const account =
    usable.find((row) => row.id === accountId) ??
    (moves ? usable[0] : undefined);
  const effectiveCurrency =
    mode === "lend" || mode === "borrow"
      ? (account?.currency ?? currency)
      : currency;
  const digits = currencyDigits(effectiveCurrency);
  const field = (message: string) => {
    setError(message);
    return false;
  };
  const submit = async () => {
    setError("");
    let minor = 0;
    if (mode !== "forgive") {
      try {
        minor = parseMinorUnits(amount, digits);
      } catch {
        return field("Enter an amount using numbers only.");
      }
      if (minor <= 0 && !(mode === "opening" && minor === 0 && loan))
        return field("Enter an amount greater than zero.");
    }
    if (moves && !account) return field("Choose one of your accounts.");
    if (mode === "repay" && minor > Math.abs(balance))
      return field("That is more than what is open.");
    if (mode === "forgive" && !categoryId) return field("Choose a category.");
    const body =
      mode === "forgive"
        ? {
            currency,
            categoryId: categoryId as string,
            date,
            note: note.trim() || null,
          }
        : mode === "opening"
          ? {
              amount: {
                amount: direction === "owedByMe" ? -minor : minor,
                currency,
              },
              ...(loan ? { expectedVersion: loan.version } : {}),
            }
          : ({
              accountId: (account as Account).id,
              amount: { amount: minor, currency: effectiveCurrency },
              date,
              time: null,
              note: note.trim() || null,
            } satisfies LoanMove);
    const sig = JSON.stringify([mode, client.id, body]);
    if (attempt.current?.sig !== sig)
      attempt.current = {
        sig,
        run: prepareLoanWrite(ledgerId, client.id, mode, body),
      };
    setBusy(true);
    try {
      await attempt.current.run();
      attempt.current = null;
      onSaved();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status < 500) {
        attempt.current = null;
        setError(failure.message);
      } else setError("We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const currencyChoices =
    mode === "opening"
      ? values.currencies
      : mode === "repay" || mode === "forgive"
        ? open.map((row) => row.currency)
        : [];
  return (
    <EditorDialog
      open
      title={title}
      description={description}
      busy={busy}
      onDismiss={onClose}
      returnFocusId={returnFocusId}
      closeLabel="Close loan dialog"
      fallbackFocusId="main-content"
      initialFocusId={mode === "forgive" ? "loan-category" : "loan-amount"}
    >
      <form
        className="account-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="client-fields">
          {currencyChoices.length > 1 && (
            <label className="form-field" htmlFor="loan-currency">
              Currency
              <NativeSelect
                id="loan-currency"
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value);
                  setAccountId("");
                }}
              >
                {currencyChoices.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
          {(mode === "repay" || mode === "forgive") && loan && (
            <p>
              {owedToYou
                ? `${client.name} owes you `
                : `You owe ${client.name} `}
              <Amount
                value={Math.abs(balance)}
                currency={loan.balance.currency}
              />
            </p>
          )}
          {mode === "opening" && (
            <label className="form-field" htmlFor="loan-direction">
              Who owes whom
              <NativeSelect
                id="loan-direction"
                value={direction}
                onChange={(event) =>
                  setDirection(event.target.value as "owedToMe" | "owedByMe")
                }
              >
                <option value="owedToMe">{client.name} owes me</option>
                <option value="owedByMe">I owe {client.name}</option>
              </NativeSelect>
            </label>
          )}
          {mode === "opening" && loan && (
            <p className="muted">
              This replaces the balance from before Ledgerline, currently{" "}
              <Amount
                value={loan.openingBalance.amount}
                currency={loan.currency}
              />
              . Money you lend or repay later stays on top of it.
            </p>
          )}
          {moves && (
            <label className="form-field" htmlFor="loan-account">
              {mode === "lend"
                ? "Paid from"
                : mode === "borrow"
                  ? "Received into"
                  : owedToYou
                    ? "Received into"
                    : "Paid from"}
              <NativeSelect
                id="loan-account"
                value={account?.id ?? ""}
                onChange={(event) => setAccountId(event.target.value)}
              >
                {usable.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({row.currency})
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
          {mode !== "forgive" && (
            <label className="form-field" htmlFor="loan-amount">
              Amount ({effectiveCurrency})
              <AmountInput
                id="loan-amount"
                currency={effectiveCurrency}
                inputMode="decimal"
                value={amount}
                maxLength={30}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          )}
          {mode === "forgive" && (
            <div className="form-field">
              {categories.isError ? (
                <p role="alert">Could not load categories.</p>
              ) : (
                <CategoryPicker
                  categories={categories.data ?? []}
                  kind={owedToYou ? "expense" : "income"}
                  value={categoryId}
                  onChange={setCategoryId}
                  label={owedToYou ? "Expense category" : "Income category"}
                />
              )}
            </div>
          )}
          {mode !== "opening" && (
            <label className="form-field" htmlFor="loan-date">
              Date
              <DateTimeInput
                label="Date"
                id="loan-date"
                type="date"
                value={date}
                required
                min="0001-01-01"
                max="9999-12-31"
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          )}
          {mode !== "opening" && (
            <label className="form-field" htmlFor="loan-note">
              Note (optional)
              <input
                id="loan-note"
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy
              ? "Saving…"
              : mode === "lend"
                ? "Lend"
                : mode === "borrow"
                  ? "Borrow"
                  : mode === "repay"
                    ? "Record repayment"
                    : mode === "forgive"
                      ? "Forgive"
                      : "Save existing loan"}
          </button>
        </div>
      </form>
    </EditorDialog>
  );
}
