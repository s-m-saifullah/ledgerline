import { SegmentedControl } from "@ledgerline/ui";
import type { ReactNode } from "react";
import { Amount } from "../../components/amount-text";
import { CategoryCombo } from "../../components/category-combo";
import { DateTimeInput } from "../../components/date-time-input";
import { EntryAmount } from "../../components/entry-amount";
import { PickRow } from "../../components/pick-row";
import { shortHints } from "./loan-copy";
import { type LoanForm, NEW } from "./loan-form-context";

/**
 * A part of the form that comes and goes with the choice above it. In "Add loan" the choice changes while the
 * sheet is open, so the part folds shut over a short moment instead of vanishing and dropping the sheet's height
 * at once; in a sheet opened for one action it is simply left out. A shut part cannot be focused or read.
 */
export function Fold({
  shut,
  animate,
  children,
}: {
  shut: boolean;
  animate: boolean;
  children: ReactNode;
}) {
  if (!animate) return shut ? null : children;
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

/** "Add loan" only: what happened, and with whom. */
export function WhoSection({ form }: { form: LoanForm }) {
  const { adding, kind, setKind, people, chosen, choosePerson } = form;
  if (!adding) return null;
  return (
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
          onChange={choosePerson}
        />
        {chosen === NEW && (
          <div className="ln-row">
            <label htmlFor="loan-name">Name</label>
            <input
              id="loan-name"
              value={form.newName}
              maxLength={100}
              placeholder="Name"
              onChange={(event) => form.setNewName(event.target.value)}
            />
          </div>
        )}
      </div>
    </>
  );
}

/** The short line under the choice: what this action is, or what a waiver is recorded as. */
export function HintLine({ form }: { form: LoanForm }) {
  const { kind, owedToYou } = form;
  if (kind === "waive")
    return (
      <p className="ln-note">
        {owedToYou
          ? "Recorded as an expense in the category you choose."
          : "Recorded as income in the category you choose."}
      </p>
    );
  const hint = shortHints[kind];
  return hint ? <p className="ln-note">{hint}</p> : null;
}

/** "Who owes whom", only while adding a loan from before Ledgerline. */
export function DirectionFold({ form }: { form: LoanForm }) {
  const { name, direction, setDirection } = form;
  return (
    <Fold shut={form.kind !== "opening"} animate={form.adding}>
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
  );
}

/** What is open now (repay, waive), or what an existing loan replaces (opening). */
export function BalanceNotes({ form }: { form: LoanForm }) {
  const { kind, loan, name, owedToYou, balance } = form;
  return (
    <>
      {(kind === "repay" || kind === "waive") && loan && (
        <p className="ln-note" role="status">
          {owedToYou ? `${name} owes you ` : `You owe ${name} `}
          <Amount cents={Math.abs(balance)} currency={loan.balance.currency} />
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
    </>
  );
}

export function AmountField({ form }: { form: LoanForm }) {
  const { kind, effectiveCurrency, error, amount, setAmount } = form;
  if (kind === "waive") return null;
  return (
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
  );
}

/** The currency row, only when there is more than one to choose from. */
export function CurrencyFold({ form }: { form: LoanForm }) {
  const { currencyChoices, currency, chooseCurrency } = form;
  return (
    <Fold shut={currencyChoices.length < 2} animate={form.adding}>
      <div className="ln-group">
        <PickRow
          id="loan-currency"
          label="Currency"
          value={currency}
          options={currencyChoices.map((code) => ({
            value: code,
            label: code,
          }))}
          onChange={chooseCurrency}
        />
      </div>
    </Fold>
  );
}

/** Account (or the waiver's category), date and note. */
export function DetailsFold({ form }: { form: LoanForm }) {
  const { kind, adding, moves, usable, account, owedToYou, categories } = form;
  return (
    <Fold shut={kind === "opening"} animate={adding}>
      <div className="ln-group">
        {/* While folding shut it keeps its row, so the part does not shrink before it starts to fade. */}
        {(moves || adding) && (
          <PickRow
            id="loan-account"
            label={form.accountLabel}
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
            onChange={form.setAccountId}
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
                value={form.categoryId}
                onChange={form.setCategoryId}
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
            value={form.date}
            required
            min="0001-01-01"
            max="9999-12-31"
            onChange={(event) => form.setDate(event.target.value)}
          />
        </div>
        <div className="ln-row">
          <label htmlFor="loan-note">Note (Optional)</label>
          <input
            id="loan-note"
            value={form.note}
            maxLength={2000}
            placeholder="Add"
            onChange={(event) => form.setNote(event.target.value)}
          />
        </div>
      </div>
    </Fold>
  );
}
