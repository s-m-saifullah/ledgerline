import {
  type Account,
  currencyDigits,
  type LoanBalance,
  type LoanMove,
  type LoanPerson,
  parseMinorUnits,
} from "@ledgerline/shared";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Amount } from "../../components/amount";
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
import {
  type LoanAction,
  prepareCreatePerson,
  prepareLoanWrite,
} from "./loans-api";

const NEW = "new";
const hints = (
  name: string,
  owedToYou: boolean,
): Record<LoanAction, string> => ({
  lend: `The money leaves the account you choose and is recorded as owed by ${name}. It is a transfer, not spending.`,
  borrow: `The money enters the account you choose and is recorded as owed to ${name}. It is a transfer, not income.`,
  repay: owedToYou
    ? `${name} pays you back into the account you choose.`
    : `You pay ${name} back from the account you choose.`,
  waive: owedToYou
    ? `You give up what ${name} owes you. It is recorded as an expense in the category you choose.`
    : `${name} gives up what you owe. It is recorded as income in the category you choose.`,
  opening:
    "Record money that was already lent or borrowed before you used Ledgerline. Nothing changes in any of your accounts.",
});
const titles = (name: string): Record<LoanAction, string> => ({
  lend: name ? `Lend money to ${name}` : "Lend money",
  borrow: name ? `Borrow money from ${name}` : "Borrow money",
  repay: "Record a repayment",
  waive: "Waive what is left",
  opening: "Add an existing loan",
});

/**
 * Lend, borrow, repay, waive or add an existing loan (ADR 0030): one form. Opened for one
 * person it is that person's action; opened without one ("Add loan") it first asks who, and
 * whether it is a loan, a borrowing or one you already had.
 */
export function LoanDialog({
  ledgerId,
  person,
  people = [],
  loans: personLoans = [],
  mode,
  returnFocusId,
  onClose,
  onSaved,
}: {
  ledgerId: string;
  person: { id: string; name: string } | null;
  /** For "Add loan": the people to choose from. */
  people?: LoanPerson[];
  loans?: LoanBalance[];
  mode: LoanAction;
  returnFocusId: string;
  onClose: () => void;
  onSaved: (personId: string) => void;
}) {
  const values = useBaseValues(ledgerId);
  const adding = person === null;
  const [kind, setKind] = useState<LoanAction>(mode);
  // With people to choose from nobody is preselected, so a loan is never saved to the wrong one.
  const [chosen, setChosen] = useState(people.length > 0 ? "" : NEW);
  const [newName, setNewName] = useState("");
  const picked = adding ? people.find((row) => row.id === chosen) : undefined;
  const name = adding ? (picked?.name ?? newName.trim()) : person.name;
  const loans = adding ? (picked?.balances ?? []) : personLoans;
  const open = loans.filter((loan) => loan.balance.amount !== 0);
  const [currency, setCurrency] = useState(
    mode === "repay" || mode === "waive"
      ? (open[0]?.currency ?? values.baseCurrency)
      : values.baseCurrency,
  );
  const loan = loans.find((row) => row.currency === currency);
  const balance = loan?.balance.amount ?? 0;
  const owedToYou = balance > 0;
  const moves = kind === "lend" || kind === "borrow" || kind === "repay";
  const accounts = useQuery({
    queryKey: ["accounts", ledgerId, "active-own"],
    queryFn: ({ signal }) => getActiveAccounts(ledgerId, signal),
    enabled: moves,
  });
  const categories = useQuery({
    queryKey: ["categories", ledgerId, "loan-waive"],
    queryFn: ({ signal }) => getCategories(ledgerId, signal),
    enabled: kind === "waive",
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
  // A new person is created once, even when the loan itself has to be retried.
  const created = useRef<{ name: string; id: string } | null>(null);
  const usable = (accounts.data ?? []).filter(
    (account: Account) =>
      kind === "lend" || kind === "borrow" || account.currency === currency,
  );
  const account =
    usable.find((row) => row.id === accountId) ??
    (moves ? usable[0] : undefined);
  const effectiveCurrency =
    kind === "lend" || kind === "borrow"
      ? (account?.currency ?? currency)
      : currency;
  const digits = currencyDigits(effectiveCurrency);
  const fail = (message: string) => {
    setError(message);
  };
  const submit = async () => {
    setError("");
    if (adding && chosen === "") return fail("Choose who this is with.");
    if (adding && chosen === NEW && !newName.trim())
      return fail("Enter the person's name.");
    let minor = 0;
    if (kind !== "waive") {
      try {
        minor = parseMinorUnits(amount, digits);
      } catch {
        return fail("Enter an amount using numbers only.");
      }
      if (minor <= 0 && !(kind === "opening" && minor === 0 && loan))
        return fail("Enter an amount greater than zero.");
    }
    if (moves && !account) return fail("Choose one of your accounts.");
    if (kind === "repay" && minor > Math.abs(balance))
      return fail("That is more than what is open.");
    if (kind === "waive" && !categoryId) return fail("Choose a category.");
    const body =
      kind === "waive"
        ? {
            currency,
            categoryId: categoryId as string,
            date,
            note: note.trim() || null,
          }
        : kind === "opening"
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
    setBusy(true);
    try {
      let personId = person?.id ?? picked?.id ?? "";
      if (!personId) {
        const trimmed = newName.trim();
        if (created.current?.name !== trimmed)
          created.current = {
            name: trimmed,
            id: (await prepareCreatePerson(ledgerId, trimmed)()).id,
          };
        personId = created.current.id;
      }
      const sig = JSON.stringify([kind, personId, body]);
      if (attempt.current?.sig !== sig)
        attempt.current = {
          sig,
          run: prepareLoanWrite(ledgerId, personId, kind, body),
        };
      await attempt.current.run();
      attempt.current = null;
      onSaved(personId);
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
    kind === "opening"
      ? values.currencies
      : kind === "repay" || kind === "waive"
        ? open.map((row) => row.currency)
        : [];
  const title = adding ? "Add a loan" : titles(name)[kind];
  const description = adding
    ? "Record money you lent, money you borrowed, or a loan you already had."
    : hints(name, owedToYou)[kind];
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
      initialFocusId={
        adding
          ? "loan-person"
          : kind === "waive"
            ? "loan-category"
            : "loan-amount"
      }
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
          {adding && (
            <>
              <label className="form-field" htmlFor="loan-person">
                Who
                <NativeSelect
                  id="loan-person"
                  value={chosen}
                  onChange={(event) => {
                    setChosen(event.target.value);
                    setCurrency(values.baseCurrency);
                  }}
                >
                  {people.length > 0 && (
                    <option value="" disabled>
                      Choose a person…
                    </option>
                  )}
                  {people.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                      {row.archivedAt ? " (archived)" : ""}
                    </option>
                  ))}
                  <option value={NEW}>A new person…</option>
                </NativeSelect>
              </label>
              {chosen === NEW && (
                <label className="form-field" htmlFor="loan-name">
                  Name
                  <input
                    id="loan-name"
                    value={newName}
                    maxLength={100}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                </label>
              )}
              <label className="form-field" htmlFor="loan-kind">
                What happened
                <NativeSelect
                  id="loan-kind"
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as LoanAction)
                  }
                >
                  <option value="lend">I lent money</option>
                  <option value="borrow">I borrowed money</option>
                  <option value="opening">A loan I already had</option>
                </NativeSelect>
              </label>
              <p className="muted">{hints(name || "them", owedToYou)[kind]}</p>
            </>
          )}
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
          {(kind === "repay" || kind === "waive") && loan && (
            <p>
              {owedToYou ? `${name} owes you ` : `You owe ${name} `}
              <Amount
                value={Math.abs(balance)}
                currency={loan.balance.currency}
              />
            </p>
          )}
          {kind === "opening" && (
            <label className="form-field" htmlFor="loan-direction">
              Who owes whom
              <NativeSelect
                id="loan-direction"
                value={direction}
                onChange={(event) =>
                  setDirection(event.target.value as "owedToMe" | "owedByMe")
                }
              >
                <option value="owedToMe">{name || "They"} owes me</option>
                <option value="owedByMe">I owe {name || "them"}</option>
              </NativeSelect>
            </label>
          )}
          {kind === "opening" && loan && (
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
              {kind === "lend"
                ? "Paid from"
                : kind === "borrow"
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
          {kind !== "waive" && (
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
          {kind === "waive" && (
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
          {kind !== "opening" && (
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
          {kind !== "opening" && (
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
              : kind === "lend"
                ? "Lend"
                : kind === "borrow"
                  ? "Borrow"
                  : kind === "repay"
                    ? "Record repayment"
                    : kind === "waive"
                      ? "Waive"
                      : "Save existing loan"}
          </button>
        </div>
      </form>
    </EditorDialog>
  );
}
