import type {
  Account,
  Category,
  LoanBalance,
  LoanPerson,
} from "@ledgerline/shared";
import type { LoanAction } from "./loans-api";

/** The "new person" choice in the Who row. */
export const NEW = "new";

/** What the pieces of the loan sheet read from it (one object, no hidden state). */
export type LoanForm = {
  /** "Add loan": no person yet, so the sheet asks who and what happened. */
  adding: boolean;
  kind: LoanAction;
  setKind: (kind: LoanAction) => void;
  people: LoanPerson[];
  chosen: string;
  /** Picks a person and goes back to the base currency. */
  choosePerson: (value: string) => void;
  newName: string;
  setNewName: (value: string) => void;
  name: string;
  /** The loan in the chosen currency, if there is one. */
  loan: LoanBalance | undefined;
  balance: number;
  owedToYou: boolean;
  direction: "owedToMe" | "owedByMe";
  setDirection: (value: "owedToMe" | "owedByMe") => void;
  amount: string;
  setAmount: (value: string) => void;
  currency: string;
  effectiveCurrency: string;
  /** Picks a currency and forgets the chosen account. */
  chooseCurrency: (code: string) => void;
  currencyChoices: string[];
  /** Lend, borrow or repay: the money moves between an account and the person. */
  moves: boolean;
  usable: Account[];
  account: Account | undefined;
  setAccountId: (id: string) => void;
  accountLabel: string;
  categories: { isError: boolean; data: Category[] | undefined };
  categoryId: string | null;
  setCategoryId: (id: string | null) => void;
  date: string;
  setDate: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  error: string;
};
