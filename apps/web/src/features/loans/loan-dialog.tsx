import {
  type Account,
  currencyDigits,
  type LoanBalance,
  type LoanMove,
  type LoanPerson,
  parseMinorUnits,
} from "@ledgerline/shared";
import { SegmentedControl } from "@ledgerline/ui";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Amount } from "../../components/amount-text";
import { DateTimeInput } from "../../components/date-time-input";
import { EntryAmount } from "../../components/entry-amount";
import { Overlay } from "../../components/overlay";
import { PickRow } from "../../components/pick-row";
import { ApiError } from "../../lib/api";
import { decimalFromCents } from "../../lib/money";
import { localToday } from "../../lib/time";
import { getCategories } from "../categories/api";
import { useBaseValues } from "../currencies/base-value";
import { getActiveAccounts } from "../transactions/api";
import { CategoryCombo } from "../transactions/category-combo";
import {
  type LoanAction,
  prepareCreatePerson,
  prepareLoanWrite,
} from "./loans-api";

import "./loans.css";

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
/** What the sheet draws; the full sentences above are read aloud under the title. */
const shortHints: Partial<Record<LoanAction, string>> = {
  lend: "A transfer, not spending.",
  borrow: "A transfer, not income.",
  opening: "Changes no account.",
};
const titles = (name: string): Record<LoanAction, string> => ({
  lend: name ? `Lend money to ${name}` : "Lend money",
  borrow: name ? `Borrow money from ${name}` : "Borrow money",
  repay: "Record a repayment",
  waive: "Waive what is left",
  opening: "Add an existing loan",
});

/**
 * A part of the form that comes and goes with the choice above it. In "Add loan" the choice changes while the
 * sheet is open, so the part folds shut over a short moment instead of vanishing and dropping the sheet's height
 * at once; in a sheet opened for one action it is simply left out. A shut part cannot be focused or read.
 */
function Fold({
  shut,
  animate,
  children,
}: {
  shut: boolean;
  animate: boolean;
  children: React.ReactNode;
}) {
  if (!animate) return shut ? null : <>{children}</>;
  return (
    <div
      className="ln-fold"
      data-shut={shut ? "true" : "false"}
      {...(shut ? { inert: true } : {})}
    >
      <div className="ln-fold-in">{children}</div>
    </div>
  );
}

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
  editCurrency,
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
  /** Change the balance from before Ledgerline in this currency (the currency stays fixed). */
  editCurrency?: string | undefined;
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
  const editing = editCurrency
    ? loans.find((row) => row.currency === editCurrency)
    : undefined;
  const [currency, setCurrency] = useState(
    editing
      ? editing.currency
      : mode === "repay" || mode === "waive"
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
  const [amount, setAmount] = useState(
    editing
      ? decimalFromCents(
          Math.abs(editing.openingBalance.amount),
          currencyDigits(editing.currency),
        )
      : "",
  );
  const [direction, setDirection] = useState<"owedToMe" | "owedByMe">(
    editing && editing.openingBalance.amount < 0 ? "owedByMe" : "owedToMe",
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
  const currencyChoices = editing
    ? []
    : kind === "opening"
      ? values.currencies
      : kind === "repay" || kind === "waive"
        ? open.map((row) => row.currency)
        : [];
  const title = editing
    ? "Change the balance from before Ledgerline"
    : adding
      ? "Add loan"
      : titles(name)[kind];
  // Read aloud under the title; what is drawn is the short line in the sheet.
  const description = editing
    ? `Fix the amount or who owes whom for ${name} (${editing.currency}). Nothing changes in any of your accounts.`
    : adding
      ? "Record money you lent, money you borrowed, or a loan you already had."
      : hints(name, owedToYou)[kind];
  const submitLabel =
    kind === "lend"
      ? "Lend"
      : kind === "borrow"
        ? "Borrow"
        : kind === "repay"
          ? "Record repayment"
          : kind === "waive"
            ? "Waive"
            : "Save existing loan";
  const accountLabel =
    kind === "lend"
      ? "Paid from"
      : kind === "borrow"
        ? "Received into"
        : owedToYou
          ? "Received into"
          : "Paid from";
  return (
    <Overlay
      open
      title={title}
      description={description}
      busy={busy}
      onDismiss={onClose}
      returnFocusId={returnFocusId}
      fallbackFocusId="main-content"
      initialFocusId={
        adding ? "loan-person" : kind === "waive" ? undefined : "loan-amount"
      }
      footer={
        <button
          type="submit"
          form="loan-form"
          className="ui-btn ui-btn-primary"
          disabled={busy}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
      }
    >
      <form
        id="loan-form"
        className="ln-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="ln-fields">
          {adding && (
            <>
              <SegmentedControl
                label="What happened"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "lend", label: "I lent money" },
                  { value: "borrow", label: "I borrowed money" },
                  { value: "opening", label: "A loan I already had" },
                ]}
              />
              <div className="ln-group">
                <PickRow
                  id="loan-person"
                  label="Who"
                  value={chosen}
                  options={[
                    ...(people.length > 0
                      ? [
                          {
                            value: "",
                            label: "Choose a person…",
                            short: "Choose",
                            disabled: true,
                          },
                        ]
                      : []),
                    ...people.map((row) => ({
                      value: row.id,
                      label: `${row.name}${row.archivedAt ? " (archived)" : ""}`,
                    })),
                    { value: NEW, label: "A new person…", short: "New person" },
                  ]}
                  onChange={(value) => {
                    setChosen(value);
                    setCurrency(values.baseCurrency);
                  }}
                />
                {chosen === NEW && (
                  <div className="ln-row">
                    <label htmlFor="loan-name">Name</label>
                    <input
                      id="loan-name"
                      value={newName}
                      maxLength={100}
                      placeholder="Name"
                      onChange={(event) => setNewName(event.target.value)}
                    />
                  </div>
                )}
              </div>
            </>
          )}
          {kind === "waive" ? (
            <p className="ln-note">
              {owedToYou
                ? "Recorded as an expense in the category you choose."
                : "Recorded as income in the category you choose."}
            </p>
          ) : (
            shortHints[kind] && <p className="ln-note">{shortHints[kind]}</p>
          )}
          <Fold shut={kind !== "opening"} animate={adding}>
            <SegmentedControl
              label="Who owes whom"
              value={direction}
              onChange={setDirection}
              options={[
                {
                  value: "owedToMe",
                  label: name ? `${name} owes me` : "They owe me",
                },
                { value: "owedByMe", label: `I owe ${name || "them"}` },
              ]}
            />
          </Fold>
          {(kind === "repay" || kind === "waive") && loan && (
            <p className="ln-note" role="status">
              {owedToYou ? `${name} owes you ` : `You owe ${name} `}
              <Amount
                cents={Math.abs(balance)}
                currency={loan.balance.currency}
              />
            </p>
          )}
          {kind === "opening" && loan && (
            <p className="ln-note">
              This replaces the balance from before Ledgerline, currently{" "}
              {loan.openingBalance.amount < 0 ? "you owed " : "owed to you "}
              <Amount
                cents={Math.abs(loan.openingBalance.amount)}
                currency={loan.currency}
              />
              . Money you lend or repay later stays on top of it.
            </p>
          )}
          {kind !== "waive" && (
            <EntryAmount
              id="loan-amount"
              label={`Amount (${effectiveCurrency})`}
              currency={effectiveCurrency}
              invalid={!!error}
              describedBy={error ? "loan-error" : undefined}
              inputProps={{
                value: amount,
                maxLength: 30,
                onChange: (event) => setAmount(event.target.value),
              }}
            />
          )}
          <Fold shut={currencyChoices.length < 2} animate={adding}>
            <div className="ln-group">
              <PickRow
                id="loan-currency"
                label="Currency"
                value={currency}
                options={currencyChoices.map((code) => ({
                  value: code,
                  label: code,
                }))}
                onChange={(code) => {
                  setCurrency(code);
                  setAccountId("");
                }}
              />
            </div>
          </Fold>
          <Fold shut={kind === "opening"} animate={adding}>
            <div className="ln-group">
              {/* While folding shut it keeps its row, so the part does not shrink before it starts to fade. */}
              {(moves || adding) && (
                <PickRow
                  id="loan-account"
                  label={accountLabel}
                  value={account?.id ?? ""}
                  options={
                    usable.length > 0
                      ? usable.map((row) => ({
                          value: row.id,
                          label: `${row.name} (${row.currency})`,
                          short: row.name,
                        }))
                      : [{ value: "", label: "Choose", disabled: true }]
                  }
                  onChange={setAccountId}
                />
              )}
              {kind === "waive" && (
                <div className="ln-field">
                  {categories.isError ? (
                    <p role="alert">Couldn't load categories.</p>
                  ) : (
                    <CategoryCombo
                      categories={categories.data ?? []}
                      kind={owedToYou ? "expense" : "income"}
                      value={categoryId}
                      onChange={setCategoryId}
                      label={owedToYou ? "Expense category" : "Income category"}
                    />
                  )}
                </div>
              )}
              <div className="ln-row">
                <label htmlFor="loan-date">Date</label>
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
              </div>
              <div className="ln-row">
                <label htmlFor="loan-note">Note (Optional)</label>
                <input
                  id="loan-note"
                  value={note}
                  maxLength={2000}
                  placeholder="Add"
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            </div>
          </Fold>
        </fieldset>
        {error && (
          <p id="loan-error" role="alert" className="field-error">
            {error}
          </p>
        )}
      </form>
    </Overlay>
  );
}
