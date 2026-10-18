import { type Account, type Category, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { category as makeCategory } from "../../test-support/category-fixtures";
import { ImportPage } from "./import-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, string>;
    className?: string;
  }) => (
    <a
      href={`${to}?${new URLSearchParams(search).toString()}`}
      className={className}
    >
      {children}
    </a>
  ),
}));

const ledgerId = newId();
const stamp = "2026-10-01T00:00:00.000Z";
const usd = (amount: number) => ({ amount, currency: "USD" });
const checking: Account = {
  id: newId(),
  ledgerId,
  name: "Checking",
  type: "bank",
  currency: "USD",
  openingBalance: usd(0),
  inboundBonusBps: null,
  bonusCategoryId: null,
  feeCategoryId: null,
  defaultFee: null,
  contactId: null,
  balance: usd(0),
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
};
const food = makeCategory("Food");
const fun = makeCategory("Fun");
const salary = makeCategory("Salary", { kind: "income" });
const categories: Category[] = [food, fun, salary];
const batch = {
  id: newId(),
  accountId: checking.id,
  sourceName: "statement.csv",
  rowCount: 3,
  remaining: 3,
  createdAt: stamp,
  version: 1,
};

type Calls = { url: string; method: string; body: unknown }[];
let calls: Calls;
let client: QueryClient;
let accountsList: Account[];
let previewFails: boolean;
let recent: (typeof batch)[];

function stub() {
  calls = [];
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input).replace("/api/v1", "");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url === "/ledgers")
        return json({
          items: [
            {
              id: ledgerId,
              name: "Personal",
              baseCurrency: "USD",
              timeZone: null,
              version: 1,
              role: "owner",
            },
          ],
        });
      if (url.includes("/accounts?"))
        return json({ items: accountsList, nextCursor: null });
      if (url.includes("/categories?"))
        return json({ items: categories, nextCursor: null });
      if (url.endsWith("/imports") && method === "GET")
        return json({ items: recent });
      if (url.endsWith("/imports/preview")) {
        if (previewFails) return json({}, 500);
        return json({
          rows: body.rows.map((row: { line: number; amount: number }) => ({
            line: row.line,
            // The 4.50 coffee is already in the ledger.
            state: row.amount === 450 ? "duplicate" : "ready",
            reason:
              row.amount === 450
                ? "Same date and amount as an entry already in this account."
                : null,
          })),
          counts: { ready: 0, duplicate: 0, problem: 0 },
        });
      }
      if (url.endsWith("/imports") && method === "POST")
        return json(
          {
            batch: {
              ...batch,
              rowCount: body.rows.length,
              remaining: body.rows.length,
            },
            duplicatesIncluded: body.rows.filter(
              (r: { amount: number }) => r.amount === 450,
            ).length,
          },
          201,
        );
      if (url.endsWith("/undo")) return json({ removed: 3 });
      return json({}, 404);
    }),
  );
}
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ImportPage />
    </QueryClientProvider>,
  );
}
const file = (text: string, name = "statement.csv") =>
  new File([text], name, { type: "text/csv" });
const upload = (text: string, name?: string) =>
  userEvent.upload(screen.getByLabelText("CSV file"), file(text, name));
const STATEMENT =
  "Date,Description,Amount,Category\n" +
  "2026-10-02,Corner shop,-4.50,Food\n" +
  "2026-10-03,Cinema,-12.00,Travel\n" +
  "2026-10-04,Pay,2500.00,Salary\n";

beforeEach(() => {
  accountsList = [checking];
  previewFails = false;
  recent = [];
  stub();
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ImportPage", () => {
  it("imports a statement from the file to Undo", async () => {
    mount();
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Import into")).toBeTruthy();
    await upload(STATEMENT);
    // Columns: guessed from the header, with all three rows readable.
    expect(await screen.findByText("Match your columns")).toBeTruthy();
    expect(screen.getByLabelText("Date")).toHaveProperty("value", "0");
    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "2");
    expect(screen.getByText(/We can read/).textContent).toContain("3 rows");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    // Categories: "Travel" matches nothing, so it needs a choice.
    expect(await screen.findByText("Choose categories")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.selectOptions(screen.getByLabelText(/Travel/), fun.id);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    // Review: the coffee looks like a duplicate and is left out until ticked.
    expect(await screen.findByText("Possible duplicates")).toBeTruthy();
    const importButton = await screen.findByRole("button", {
      name: "Import 2 entries",
    });
    await user.click(screen.getByRole("checkbox", { name: /Corner shop/ }));
    await user.click(screen.getByRole("button", { name: "Import 3 entries" }));
    expect(await screen.findByText("Imported 3 entries")).toBeTruthy();
    expect(importButton).toBeTruthy();
    const create = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/imports"),
    );
    expect(create?.body).toMatchObject({
      accountId: checking.id,
      sourceName: "statement.csv",
    });
    expect(create).toBeDefined();
    const rows = (
      create as {
        body: {
          rows: {
            line: number;
            kind: string;
            amount: number;
            categoryId: string;
            payee: string;
          }[];
        };
      }
    ).body.rows;
    expect(
      rows.map((r) => [r.line, r.kind, r.amount, r.categoryId, r.payee]),
    ).toEqual([
      [2, "expense", 450, food.id, "Corner shop"],
      [3, "expense", 1200, fun.id, "Cinema"],
      [4, "income", 250000, salary.id, "Pay"],
    ]);
    expect(
      screen.getByText(/looked like entries you already had/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "View in Transactions" })
        .getAttribute("href"),
    ).toBe(
      `/transactions?accountId=${checking.id}&from=2026-10-02&to=2026-10-04`,
    );
    // Undo asks first, then deletes.
    await user.click(screen.getByRole("button", { name: "Undo this import" }));
    expect(screen.getByText(/deletes the 3 entries/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Delete these entries" }),
    );
    expect(await screen.findByText("Removed 3 entries.")).toBeTruthy();
    const undo = calls.find((c) => c.url.endsWith("/undo"));
    expect(undo?.body).toEqual({ expectedVersion: 1 });
  });

  it("skips the categories step when every name matches", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Import into");
    await upload(
      "Date,Amount,Category\n2026-10-02,-4.00,Food\n2026-10-03,9.00,Salary\n",
    );
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Review before importing")).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Import 2 entries" }),
    ).toBeTruthy();
  });

  it("asks for a default category when the file has none", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Import into");
    await upload("Date,Amount\n2026-10-02,-4.00\n2026-10-03,9.00\n");
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Choose categories")).toBeTruthy();
    await user.selectOptions(
      screen.getByLabelText("Default expense category"),
      food.id,
    );
    await user.selectOptions(
      screen.getByLabelText("Default income category"),
      salary.id,
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("button", { name: "Import 2 entries" }),
    ).toBeTruthy();
  });

  it("explains what a mapping lacks and lets the owner fix it", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Import into");
    await upload("When,How much\n2026-10-02,-4.00\n");
    expect(await screen.findByText("Choose the date column.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.selectOptions(screen.getByLabelText("Date"), "0");
    expect(screen.getByText("Choose the amount column.")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Amount"), "1");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("rejects an empty file and one that is too long", async () => {
    mount();
    await screen.findByLabelText("Import into");
    await upload("Date,Amount\n");
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This file has no rows to import.",
    );
    const many = `Date,Amount\n${"2026-10-02,-1.00\n".repeat(5001)}`;
    await upload(many);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "more than 5,000 rows",
      ),
    );
  });

  it("offers the template next to the file chooser", async () => {
    mount();
    await screen.findByLabelText("Import into");
    let saved = "";
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        const reader = new FileReader();
        reader.onload = () => {
          saved = String(reader.result);
        };
        reader.readAsText(blob);
        return "blob:template";
      },
      revokeObjectURL: () => undefined,
    });
    const clicks = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("ledgerline-import-template.csv");
      });
    await userEvent.click(
      screen.getByRole("button", { name: "Download CSV template" }),
    );
    expect(clicks).toHaveBeenCalled();
    await waitFor(() =>
      expect(saved.startsWith("date,time,type,amount,category")).toBe(true),
    );
    expect(saved).toContain("2026-01-15,,expense,12.50,Food,Groceries");
  });

  it("offers a retry when the rows cannot be checked and imports nothing", async () => {
    previewFails = true;
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Import into");
    await upload("Date,Amount,Category\n2026-10-02,-4.00,Food\n");
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/couldn't check the rows/)).toBeTruthy();
    expect(
      within(document.body).queryByRole("button", { name: /^Import \d/ }),
    ).toHaveProperty("disabled", true);
    expect(
      calls.some((c) => c.method === "POST" && c.url.endsWith("/imports")),
    ).toBe(false);
  });

  it("lists recent imports and keeps the undo message after the list refreshes", async () => {
    recent = [batch];
    mount();
    const user = userEvent.setup();
    expect(await screen.findByText("Recent imports")).toBeTruthy();
    expect(
      screen.getByText(/3 of 3 entries still in your ledger/),
    ).toBeTruthy();
    recent = [];
    await user.click(screen.getByRole("button", { name: "Undo this import" }));
    await user.click(
      screen.getByRole("button", { name: "Delete these entries" }),
    );
    expect(
      await screen.findByText("Removed 3 entries from statement.csv."),
    ).toBeTruthy();
  });

  it("asks for an account first when there is none", async () => {
    accountsList = [];
    mount();
    expect(await screen.findByText(/Add an account first/)).toBeTruthy();
  });
});
