import type { Account, Category } from "@ledgerline/shared";
import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormReturn,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import type { TransactionFormValues } from "../form";

/** What the quick add form's field sections read from the form (one object, no hidden state). */
export type QuickAddContext = {
  form: UseFormReturn<TransactionFormValues>;
  register: UseFormRegister<TransactionFormValues>;
  control: Control<TransactionFormValues>;
  watch: UseFormWatch<TransactionFormValues>;
  setValue: UseFormSetValue<TransactionFormValues>;
  errors: FieldErrors<TransactionFormValues>;
  ledgerId: string;
  privateMode: boolean;
  frozen: boolean;
  kind: Category["kind"];
  accounts: readonly Account[];
  activeAccounts: readonly Account[];
  categories: readonly Category[];
  newCategory: boolean;
  setNewCategory: (update: (value: boolean) => boolean) => void;
  categoryName: string;
  setCategoryName: (name: string) => void;
  createCategory: () => Promise<void>;
  categoryError: string;
  categoryUncertain: boolean;
  error: string;
  uncertain: boolean;
  busy: boolean;
  blocked: boolean;
  writable: boolean;
  setRefreshing: (refreshing: boolean) => void;
  onRefresh: () => Promise<void>;
};
