import {
  type Account,
  currencyDigits,
  type LoanBalance,
  type LoanMove,
  type LoanPerson,
} from "@ledgerline/shared";
import { useRef, useState } from "react";
import { Overlay } from "../../components/overlay";
import { ApiError } from "../../lib/api";
import { useBaseValues } from "../../lib/base-values";
import { decimalFromCents } from "../../lib/money";
import { localToday } from "../../lib/time";
import { useActiveAccounts } from "../../lib/use-accounts";
import { useCategories } from "../../lib/use-categories";
import { accountLabelFor, hints, submitLabelFor, titles } from "./loan-copy";
import { type LoanForm, NEW } from "./loan-form-context";
import {
  AmountField,
  BalanceNotes,
  CurrencyFold,
  DetailsFold,
  DirectionFold,
  HintLine,
  WhoSection,
} from "./loan-sections";
import {
  type LoanAction,
  prepareCreatePerson,
  prepareLoanWrite,
} from "./loans-api";

import "./loans.css";
import { typedMinor } from "../../lib/amount-input";

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
  const accounts = useActiveAccounts(ledgerId, {
    ownOnly: true,
    enabled: moves,
  });
  const categories = useCategories(ledgerId, kind === "waive");
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
        minor = typedMinor(amount, digits);
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
  const form: LoanForm = {
    adding,
    kind,
    setKind,
    people,
    chosen,
    choosePerson: (value) => {
      setChosen(value);
      setCurrency(values.baseCurrency);
    },
    newName,
    setNewName,
    name,
    loan,
    balance,
    owedToYou,
    direction,
    setDirection,
    amount,
    setAmount,
    currency,
    effectiveCurrency,
    chooseCurrency: (code) => {
      setCurrency(code);
      setAccountId("");
    },
    currencyChoices,
    moves,
    usable,
    account,
    setAccountId,
    accountLabel: accountLabelFor(kind, owedToYou),
    categories,
    categoryId,
    setCategoryId,
    date,
    setDate,
    note,
    setNote,
    error,
  };
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
          {busy ? "Saving…" : submitLabelFor(kind)}
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
          <WhoSection form={form} />
          <HintLine form={form} />
          <DirectionFold form={form} />
          <BalanceNotes form={form} />
          <AmountField form={form} />
          <CurrencyFold form={form} />
          <DetailsFold form={form} />
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
