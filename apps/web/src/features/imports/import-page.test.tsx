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
let accountsFail: boolean;
let undoFails: boolean;
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
      if (url.includes("/accounts?")) {
        if (accountsFail) return json({}, 500);
        return json({ items: accountsList, nextCursor: null });
      }
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
      if (url.endsWith("/undo")) {
        if (undoFails)
          return json(
            {
              type: "about:blank",
              title: "Conflict",
              status: 409,
              detail: "These entries changed. Reload and try again.",
              errors: [],
            },
            409,
          );
        return json({ removed: 3 });
      }
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
/** The step the progress list marks as current. */
const current = () =>
  screen
    .getByRole("list", { name: "Progress" })
    .querySelector("[aria-current=step]")?.textContent;
const columnsShown = () =>
  screen.findByRole("switch", { name: "The first row holds column names" });
/** The recent import's row: its text is its name, since the row itself is the button. */
const recentRow = () => screen.getByRole("button", { name: /statement\.csv/ });
const STATEMENT =
  "Date,Description,Amount,Category\n" +
  "2026-10-02,Corner shop,-4.50,Food\n" +
  "2026-10-03,Cinema,-12.00,Travel\n" +
  "2026-10-04,Pay,2500.00,Salary\n";

beforeEach(() => {
  accountsList = [checking];
  previewFails = false;
  accountsFail = false;
  undoFails = false;
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
    expect(await columnsShown()).toBeTruthy();
    expect(current()).toBe("2Columns");
    expect(screen.getByLabelText("Date")).toHaveProperty("value", "0");
    expect(screen.getByLabelText("Amount")).toHaveProperty("value", "2");
    expect(screen.getByText(/We can read/).textContent).toContain("3 rows");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    // Categories: "Travel" matches nothing, so it needs a choice.
    expect(await screen.findByLabelText(/Travel/)).toBeTruthy();
    expect(current()).toBe("3Categories");
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
    const question = screen.getByRole("dialog", { name: "Undo this import?" });
    expect(within(question).getByText(/deletes the 3 entries/)).toBeTruthy();
    await user.click(
      within(question).getByRole("button", { name: "Delete these entries" }),
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
    expect(
      await screen.findByRole("button", { name: /^Import \d/ }),
    ).toBeTruthy();
    expect(current()).toBe("4Review");
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
    expect(
      await screen.findByLabelText("Default expense category"),
    ).toBeTruthy();
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
    await user.click(recentRow());
    await user.click(
      screen.getByRole("button", { name: "Delete these entries" }),
    );
    expect(
      await screen.findByText("Removed 3 entries from statement.csv."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Undo this import?" }),
      ).toBeNull(),
    );
  });

  it("is one page, Import and export, with its heading as the one h1", async () => {
    mount();
    await screen.findByLabelText("Import into");
    const h1 = screen.getAllByRole("heading", { level: 1 });
    expect(h1.map((node) => node.textContent)).toEqual(["Import and export"]);
    expect(screen.queryByText(/Add entries from a bank statement/)).toBeNull();
    expect(screen.queryByText("BRING IN YOUR HISTORY")).toBeNull();
  });

  it("offers the export beside the import on every step: the dates and the three files", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Import into");
    const exportShown = () => {
      expect(screen.getByRole("heading", { name: "Export" })).toBeTruthy();
      expect(screen.getByLabelText("From date")).toBeTruthy();
      expect(screen.getByLabelText("To date")).toBeTruthy();
      for (const name of [
        "Download transactions",
        "Download accounts",
        "Download categories",
      ])
        expect(screen.getByRole("button", { name })).toBeTruthy();
    };
    exportShown();
    await upload(STATEMENT);
    await columnsShown();
    exportShown();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByLabelText("Import into");
    exportShown();
  });

  it("still offers the export when there is no account to import into", async () => {
    accountsList = [];
    mount();
    expect(await screen.findByText(/Add an account first/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download accounts" }),
    ).toBeTruthy();
  });

  it("is a dashed drop zone with the limits as its one line, and the file input keeps its name", async () => {
    mount();
    await screen.findByLabelText("Import into");
    expect(screen.getByText("Choose a CSV file")).toBeTruthy();
    expect(screen.getByText("5 MB and 5,000 rows at most")).toBeTruthy();
    expect(screen.getByLabelText("CSV file").getAttribute("type")).toBe("file");
    expect(screen.queryByText(/Not sure how to lay out/)).toBeNull();
  });

  it("marks the current step in the progress list and moves it on", async () => {
    mount();
    await screen.findByLabelText("Import into");
    const steps = () =>
      within(screen.getByRole("list", { name: "Progress" })).getAllByRole(
        "listitem",
      );
    expect(steps().map((node) => node.textContent)).toEqual([
      "1File",
      "2Columns",
      "3Categories",
      "4Review",
    ]);
    expect(steps()[0]?.getAttribute("aria-current")).toBe("step");
    await upload(STATEMENT);
    await columnsShown();
    expect(steps()[0]?.getAttribute("aria-current")).toBeNull();
    expect(steps()[1]?.getAttribute("aria-current")).toBe("step");
  });

  it("asks before undoing in a centred question and does nothing when the owner keeps the entries", async () => {
    recent = [batch];
    mount();
    const user = userEvent.setup();
    await screen.findByText("Recent imports");
    await user.click(recentRow());
    const question = await screen.findByRole("dialog", {
      name: "Undo this import?",
    });
    await user.click(
      within(question).getByRole("button", { name: "Keep them" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Undo this import?" })).toBe(
        null,
      ),
    );
    expect(calls.some((c) => c.url.endsWith("/undo"))).toBe(false);
  });

  it("cannot undo an import with nothing left in the ledger", async () => {
    recent = [{ ...batch, remaining: 0 }];
    mount();
    await screen.findByText("Recent imports");
    expect(recentRow()).toHaveProperty("disabled", true);
    expect(within(recentRow()).queryByText("Undo")).toBeNull();
  });

  it("shows Undo as the accent label at the end of a recent import's row", async () => {
    recent = [batch];
    mount();
    await screen.findByText("Recent imports");
    expect(within(recentRow()).getByText("Undo")).toBeTruthy();
    expect(recentRow()).toHaveProperty("disabled", false);
  });

  it("shows the file's header row as column headings, and none when the first row is data", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Import into");
    await upload(STATEMENT);
    const header = await columnsShown();
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Date", "Description", "Amount", "Category"]);
    await user.click(header);
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
  });

  it("shows the column and amount choices as rows, switches and a segmented control", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Import into");
    await upload(STATEMENT);
    const header = await columnsShown();
    expect(header.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("switch", { name: "Positive is spending" }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("option", { name: "Description (Corner shop)" })
        .length,
    ).toBeGreaterThan(0);
    // The row shows the chosen column, and the list under it is the platform's own.
    expect(
      screen.getByLabelText("Date").closest(".ui-pick-row")?.textContent,
    ).toContain("Date (2026-10-02)");
    await user.click(header);
    expect(header.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getAllByRole("option", { name: "Column 2 (Description)" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("radio", { name: "One amount column" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await user.click(screen.getByRole("radio", { name: "Amount and type" }));
    expect(screen.getByLabelText("Income or expense")).toBeTruthy();
    expect(
      screen.queryByRole("switch", { name: "Positive is spending" }),
    ).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Money in and out" }));
    expect(screen.getByLabelText("Money out (spending)")).toBeTruthy();
    expect(screen.getByLabelText("Money in (income)")).toBeTruthy();
    expect(screen.queryByLabelText("Amount")).toBeNull();
  });

  it("shows no export while the page is loading or when it could not load", async () => {
    accountsFail = true;
    mount();
    expect(
      await screen.findByText(/Couldn't load your accounts and categories/),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Export" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Download accounts" }),
    ).toBeNull();
  });

  it("marks the steps behind as done and the current one as current", async () => {
    mount();
    await screen.findByLabelText("Import into");
    await upload(STATEMENT);
    await columnsShown();
    const items = within(
      screen.getByRole("list", { name: "Progress" }),
    ).getAllByRole("listitem");
    expect(items.map((node) => node.className)).toEqual(["done", "", "", ""]);
  });

  it("treats an export range that starts and ends on one day as valid", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByLabelText("Import into");
    await user.type(screen.getByLabelText("From date"), "2026-10-09");
    await user.type(screen.getByLabelText("To date"), "2026-10-09");
    expect(screen.queryByText(/Choose an end date/)).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download transactions" }),
      ).toHaveProperty("disabled", false),
    );
  });

  it("shows why an undo failed inside the question, and clears it when the question is closed", async () => {
    recent = [batch];
    undoFails = true;
    mount();
    const user = userEvent.setup();
    await screen.findByText("Recent imports");
    await user.click(recentRow());
    const question = await screen.findByRole("dialog", {
      name: "Undo this import?",
    });
    await user.click(
      within(question).getByRole("button", { name: "Delete these entries" }),
    );
    expect(
      await within(question).findByText(/These entries changed/),
    ).toBeTruthy();
    expect(screen.queryByText(/Removed 3 entries/)).toBeNull();
    await user.click(
      within(question).getByRole("button", { name: "Keep them" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Undo this import?" }),
      ).toBeNull(),
    );
    await user.click(recentRow());
    const again = await screen.findByRole("dialog", {
      name: "Undo this import?",
    });
    expect(within(again).queryByText(/These entries changed/)).toBeNull();
  });

  it("says how many of an import's entries are still in the ledger", async () => {
    recent = [{ ...batch, rowCount: 3, remaining: 1 }];
    mount();
    expect(
      await screen.findByText(/1 of 3 entries still in your ledger/),
    ).toBeTruthy();
  });

  it("says one entry in the singular on a recent import", async () => {
    recent = [{ ...batch, rowCount: 1, remaining: 1 }];
    mount();
    expect(
      await screen.findByText(/1 of 1 entry still in your ledger/),
    ).toBeTruthy();
  });

  it("closes the question once the entries are removed, even while the list still shows the import", async () => {
    recent = [batch];
    mount();
    const user = userEvent.setup();
    await screen.findByText("Recent imports");
    await user.click(recentRow());
    const question = await screen.findByRole("dialog", {
      name: "Undo this import?",
    });
    await user.click(
      within(question).getByRole("button", { name: "Delete these entries" }),
    );
    expect(
      await screen.findByText("Removed 3 entries from statement.csv."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Undo this import?" }),
      ).toBeNull(),
    );
    // The list was not refreshed in this test, so the row is still there and is the thing that held the question.
    expect(recentRow()).toBeTruthy();
  });

  it("asks for an account first when there is none", async () => {
    accountsList = [];
    mount();
    expect(await screen.findByText(/Add an account first/)).toBeTruthy();
  });
});
