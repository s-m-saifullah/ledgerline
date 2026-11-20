import type { Account, Category } from "@ledgerline/shared";
import type {
  FieldErrors,
  UseFormGetFieldState,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import type { AccountFormValues } from "./form";

/** What the pieces of the account sheet read from it (one object, no hidden state). */
export type AccountForm = {
  register: UseFormRegister<AccountFormValues>;
  setValue: UseFormSetValue<AccountFormValues>;
  getFieldState: UseFormGetFieldState<AccountFormValues>;
  watch: UseFormWatch<AccountFormValues>;
  errors: FieldErrors<AccountFormValues>;
  /** The account being edited; none while adding one. */
  baseline: Account | undefined;
  type: AccountFormValues["type"];
  liability: boolean;
  currency: string;
  direction: AccountFormValues["direction"];
  bonusRate: string;
  /** Currencies a new account can use. */
  currencies: string[];
  /** Used to pick the categories of the fee and the transfer bonus. */
  categories: readonly Category[];
  privateMode: boolean;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  /** Archive, Unarchive and Delete are questions of their own; the page opens them. */
  onAction: (
    kind: "archive" | "unarchive" | "delete",
    account: Account,
  ) => void;
};
