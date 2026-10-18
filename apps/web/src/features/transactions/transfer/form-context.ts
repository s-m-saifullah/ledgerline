import type { Account, Category, Transfer } from "@ledgerline/shared";
import type { MutableRefObject } from "react";
import type {
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import type { parseFee } from "../fee";
import type { Values } from "./schema";

/** What the transfer form's field sections read from the form (one object, no hidden state). */
export type TransferFormContext = {
  register: UseFormRegister<Values>;
  watch: UseFormWatch<Values>;
  setValue: UseFormSetValue<Values>;
  errors: FieldErrors<Values>;
  accounts: readonly Account[];
  baseline: Transfer | undefined;
  categories: readonly Category[];
  privateMode: boolean;
  ledgerId: string;
  fromCurrency: string;
  toCurrency: string;
  crossCurrency: boolean;
  fromAccount: Account | undefined;
  toAccount: Account | undefined;
  bps: number | null;
  bonusOn: boolean;
  feeInput: ReturnType<typeof parseFee>;
  feeCost: number | null;
  sentMinor: number | null;
  feeCategoryId: string;
  bonusCategoryId: string;
  feeEdited: MutableRefObject<boolean>;
  bonusEdited: MutableRefObject<boolean>;
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  hasFee: boolean;
  hasBonus: boolean;
};
