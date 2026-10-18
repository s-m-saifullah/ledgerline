import type { Account, Category, RecurringRule } from "@ledgerline/shared";
import type { ReactNode } from "react";
import type { parseFee } from "../../transactions/fee";
import type { RuleFormValues } from "../form";
import type { upcomingDates } from "../schedule";

/** What the rule editor's field sections read from the editor (one object, no hidden state). */
export type RuleFormContext = {
  values: RuleFormValues;
  set: <K extends keyof RuleFormValues>(
    key: K,
    value: RuleFormValues[K],
  ) => void;
  setValues: (update: (current: RuleFormValues) => RuleFormValues) => void;
  /** Marks a field invalid when it has an error. */
  field: (key: keyof RuleFormValues) => { "aria-invalid"?: "true" };
  /** The error message under a field, if any. */
  message: (key: keyof RuleFormValues) => ReactNode;
  rule: RecurringRule | undefined;
  accounts: readonly Account[];
  categories: readonly Category[];
  from: Account | undefined;
  to: Account | undefined;
  transfer: boolean;
  cross: boolean;
  feeInput: ReturnType<typeof parseFee>;
  sentMinor: number | null;
  currency: string;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  usable: (account: Account) => boolean;
  prefillFee: (accountId: string) => void;
  preview: { next: ReturnType<typeof upcomingDates>; due: number } | null;
  interval: number;
};
