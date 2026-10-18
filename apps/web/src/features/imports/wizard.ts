import type {
  Account,
  Category,
  createImportResultSchema,
  ImportPreview,
  ImportRow,
} from "@ledgerline/shared";
import type { z } from "zod";
import type { categoryNeeds } from "./categories";
import type { ImportMapping } from "./mapping";
import type { CategoryChoices } from "./payload";
import type { readRows } from "./rows";

export type Step = "file" | "columns" | "categories" | "review" | "done";
export type LoadedFile = { name: string; table: string[][] };
export type ImportCreated = z.infer<typeof createImportResultSchema>;
export type ImportResult = ImportCreated & {
  // The dates the imported entries span, for the link to Transactions.
  from: string;
  to: string;
};

/** Everything the steps of the import screen read and change, in one place. */
export type Wizard = {
  step: Step;
  go: (step: Step) => void;
  ledgerId: string | undefined;
  accounts: Account[];
  categories: Category[];
  loading: boolean;
  loadError: boolean;
  accountId: string;
  setAccountId: (id: string) => void;
  account: Account | undefined;
  file: LoadedFile | null;
  fileError: string;
  loadFile: (file: File) => Promise<void>;
  mapping: ImportMapping;
  setMapping: (mapping: ImportMapping) => void;
  columnsProblem: string | null;
  parsed: ReturnType<typeof readRows> | null;
  continueFromColumns: () => void;
  needs: ReturnType<typeof categoryNeeds>;
  choices: CategoryChoices;
  setChoices: (choices: CategoryChoices) => void;
  ready: ImportRow[];
  unresolved: number[];
  preview: {
    data: ImportPreview | undefined;
    loading: boolean;
    failed: boolean;
    retry: () => void;
  };
  included: ReadonlySet<number>;
  toggleDuplicate: (line: number) => void;
  setAllDuplicates: (on: boolean) => void;
  toImport: ImportRow[];
  confirm: () => Promise<void>;
  confirming: boolean;
  confirmError: string;
  result: ImportResult | null;
  reset: () => void;
};
