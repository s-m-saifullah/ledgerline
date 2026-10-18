import type {
  Account,
  Category,
  Contact,
  ReceiptPreview as ReceiptPreviewData,
} from "@ledgerline/shared";
import type { Dispatch, SetStateAction } from "react";
import type { PaymentDerived } from "./derive";
import type { Fields } from "./types";

/** What the form pieces of the Clients editor read from the workspace (one object, no hidden state). */
export type OperationForm = {
  ledgerId: string | undefined;
  writable: boolean;
  frozen: boolean;
  allowWrite: boolean;
  privateMode: boolean;
  values: Fields;
  setValues: Dispatch<SetStateAction<Fields>>;
  accounts: { data: Account[] | undefined };
  categories: { data: Category[] | undefined };
  clients: { data: Contact[] | undefined };
  /** Currencies the ledger has added, for the service currency choice. */
  currencies: string[];
  preview: { data: ReceiptPreviewData | undefined; isError: boolean };
  previewCents: number | null;
  derived: PaymentDerived;
};
