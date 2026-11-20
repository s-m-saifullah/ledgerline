import type { LoanAction } from "./loans-api";

/** The texts of the loan sheet for each action. Plain words, no state. */
export const hints = (
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
export const shortHints: Partial<Record<LoanAction, string>> = {
  lend: "A transfer, not spending.",
  borrow: "A transfer, not income.",
  opening: "Changes no account.",
};

export const titles = (name: string): Record<LoanAction, string> => ({
  lend: name ? `Lend money to ${name}` : "Lend money",
  borrow: name ? `Borrow money from ${name}` : "Borrow money",
  repay: "Record a repayment",
  waive: "Waive what is left",
  opening: "Add an existing loan",
});

export function submitLabelFor(kind: LoanAction): string {
  return kind === "lend"
    ? "Lend"
    : kind === "borrow"
      ? "Borrow"
      : kind === "repay"
        ? "Record repayment"
        : kind === "waive"
          ? "Waive"
          : "Save existing loan";
}

export function accountLabelFor(kind: LoanAction, owedToYou: boolean): string {
  return kind === "lend"
    ? "Paid from"
    : kind === "borrow"
      ? "Received into"
      : owedToYou
        ? "Received into"
        : "Paid from";
}
