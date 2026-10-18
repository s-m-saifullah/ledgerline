import {
  type Category,
  detectDelimiter,
  IMPORT_MAX_ROWS,
  parseCsv,
} from "@ledgerline/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getLedgers } from "../../lib/api";
import { getCategories } from "../categories/api";
import { getActiveAccounts } from "../transactions/api";
import { prepareImport, previewImport } from "./api";
import { categoryNeeds } from "./categories";
import {
  emptyMapping,
  guessMapping,
  type ImportMapping,
  mappingProblem,
  savedMapping,
  saveMapping,
} from "./mapping";
import { type CategoryChoices, toImportRows } from "./payload";
import { readRows } from "./rows";
import type {
  ImportCreated,
  ImportResult,
  LoadedFile,
  Step,
  Wizard,
} from "./wizard";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const NO_CHOICES: CategoryChoices = {
  byWording: {},
  defaults: { expense: null, income: null },
};

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
/** A short stable key for a request body, to tell one set of rows from another. */
function fingerprint(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

export function useImportWizard(): Wizard {
  const client = useQueryClient();
  const ledgers = useQuery({ queryKey: ["ledgers"], queryFn: getLedgers });
  const ledgerId = ledgers.data?.items[0]?.id;
  const accountsQuery = useQuery({
    queryKey: ["accounts", ledgerId, "active-no-clients"],
    queryFn: ({ signal }) => getActiveAccounts(ledgerId as string, signal),
    enabled: !!ledgerId,
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", ledgerId],
    queryFn: ({ signal }) => getCategories(ledgerId as string, signal),
    enabled: !!ledgerId,
  });
  const accounts = accountsQuery.data ?? [];
  const categories: Category[] = categoriesQuery.data ?? [];
  const [step, setStep] = useState<Step>("file");
  const [chosenAccount, setAccountId] = useState("");
  const accountId = chosenAccount || accounts[0]?.id || "";
  const account = accounts.find((row) => row.id === accountId);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [fileError, setFileError] = useState("");
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping(true));
  const [choices, setChoices] = useState<CategoryChoices>(NO_CHOICES);
  const [included, setIncluded] = useState<ReadonlySet<number>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const attempt = useRef<{
    key: string;
    run: () => Promise<ImportCreated>;
  } | null>(null);

  const columnsProblem = file ? mappingProblem(mapping) : null;
  const parsed = useMemo(
    () =>
      file && account && !mappingProblem(mapping)
        ? readRows(file.table, mapping, account.currency)
        : null,
    [file, mapping, account],
  );
  const needs = useMemo(
    () => categoryNeeds(parsed?.rows ?? [], categories),
    [parsed, categories],
  );
  const { ready, unresolved } = useMemo(
    () => toImportRows(parsed?.rows ?? [], categories, choices),
    [parsed, categories, choices],
  );

  const payload =
    step === "review" && accountId && !unresolved.length && ready.length
      ? { accountId, rows: ready }
      : null;
  const payloadKey = payload ? fingerprint(JSON.stringify(payload)) : "";
  const previewQuery = useQuery({
    queryKey: ["imports", "preview", ledgerId, payloadKey],
    queryFn: ({ signal }) =>
      previewImport(
        ledgerId as string,
        payload as NonNullable<typeof payload>,
        signal,
      ),
    enabled: !!ledgerId && !!payload,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
  // A different set of rows starts again with no duplicate ticked.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new set of rows only
  useEffect(() => setIncluded(new Set()), [payloadKey]);

  const states = new Map(
    previewQuery.data?.rows.map((row) => [row.line, row.state]),
  );
  const toImport = ready.filter((row) => {
    const state = states.get(row.line);
    return (
      state === "ready" || (state === "duplicate" && included.has(row.line))
    );
  });

  const reset = () => {
    setStep("file");
    setFile(null);
    setFileError("");
    setMapping(emptyMapping(true));
    setChoices(NO_CHOICES);
    setIncluded(new Set());
    setResult(null);
    setConfirmError("");
    attempt.current = null;
  };

  return {
    step,
    go: setStep,
    ledgerId,
    accounts,
    categories,
    loading:
      ledgers.isPending || accountsQuery.isPending || categoriesQuery.isPending,
    loadError:
      ledgers.isError || accountsQuery.isError || categoriesQuery.isError,
    accountId,
    setAccountId,
    account,
    file,
    fileError,
    loadFile: async (chosen) => {
      setFileError("");
      if (chosen.size > MAX_FILE_BYTES) {
        setFileError(
          "This file is larger than 5 MB. Split it into smaller files.",
        );
        return;
      }
      try {
        const text = await readText(chosen);
        const table = parseCsv(text, detectDelimiter(text));
        if (table.length < 2) {
          setFileError("This file has no rows to import.");
          return;
        }
        if (table.length - 1 > IMPORT_MAX_ROWS) {
          setFileError(
            `This file has more than ${IMPORT_MAX_ROWS.toLocaleString("en-US")} rows. Split it into smaller files.`,
          );
          return;
        }
        const width = Math.max(...table.map((row) => row.length));
        setMapping(
          savedMapping(table[0] as string[], width) ?? guessMapping(table),
        );
        setChoices(NO_CHOICES);
        setFile({ name: chosen.name, table });
        setStep("columns");
      } catch {
        setFileError(
          "We couldn't read this file as CSV. Check that it is a plain CSV file.",
        );
      }
    },
    mapping,
    setMapping,
    columnsProblem,
    parsed,
    continueFromColumns: () => {
      if (!file) return;
      saveMapping(file.table[0] as string[], mapping);
      setStep(unresolved.length ? "categories" : "review");
    },
    needs,
    choices,
    setChoices,
    ready,
    unresolved,
    preview: {
      data: previewQuery.data,
      loading: previewQuery.isPending && !!payload,
      failed: previewQuery.isError,
      retry: () => void previewQuery.refetch(),
    },
    included,
    toggleDuplicate: (line) =>
      setIncluded((current) => {
        const next = new Set(current);
        if (next.has(line)) next.delete(line);
        else next.add(line);
        return next;
      }),
    setAllDuplicates: (on) =>
      setIncluded(
        on
          ? new Set(
              previewQuery.data?.rows
                .filter((row) => row.state === "duplicate")
                .map((row) => row.line),
            )
          : new Set(),
      ),
    toImport,
    confirm: async () => {
      if (!ledgerId || !file || !toImport.length) return;
      const body = { accountId, sourceName: file.name, rows: toImport };
      const key = fingerprint(JSON.stringify(body));
      const current =
        attempt.current?.key === key
          ? attempt.current
          : { key, run: prepareImport(ledgerId, body) };
      attempt.current = current;
      setConfirming(true);
      setConfirmError("");
      try {
        const done = await current.run();
        const dates = toImport.map((row) => row.date).sort();
        setResult({
          ...done,
          from: dates[0] as string,
          to: dates.at(-1) as string,
        });
        setStep("done");
        for (const name of [
          "transactions",
          "accounts",
          "home",
          "reports",
          "budgets",
          "imports",
        ])
          void client.invalidateQueries({ queryKey: [name] });
      } catch (error) {
        setConfirmError(
          error instanceof Error && error.message
            ? error.message
            : "We couldn't import the file. Please try again.",
        );
      } finally {
        setConfirming(false);
      }
    },
    confirming,
    confirmError,
    result,
    reset,
  };
}
