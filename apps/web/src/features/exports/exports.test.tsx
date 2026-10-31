import { newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportButton } from "./export-button";
import { ExportCard } from "./export-card";
import { exportPath } from "./paths";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
const ledgerId = newId();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exportPath", () => {
  it("passes the filters to the transactions file only", () => {
    expect(
      exportPath(ledgerId, "transactions", {
        from: "2026-10-01",
        text: "a b",
        kind: undefined,
        to: "",
      }),
    ).toBe(
      `/ledgers/${ledgerId}/exports/transactions.csv?from=2026-10-01&text=a+b`,
    );
    expect(exportPath(ledgerId, "transactions")).toBe(
      `/ledgers/${ledgerId}/exports/transactions.csv`,
    );
    expect(exportPath(ledgerId, "accounts", { from: "2026-10-01" })).toBe(
      `/ledgers/${ledgerId}/exports/accounts.csv`,
    );
  });
});

function stubDownloads(fail = false) {
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const target = String(url);
    if (target.endsWith("/ledgers"))
      return new Response(
        JSON.stringify({
          items: [
            {
              id: ledgerId,
              name: "Personal",
              baseCurrency: "USD",
              timeZone: null,
              version: 1,
              role: "viewer",
            },
          ],
        }),
      );
    if (fail)
      return new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Not found",
          status: 404,
          detail: "Ledger not found.",
        }),
        { status: 404 },
      );
    return new Response("id\r\n", {
      headers: { "content-disposition": 'attachment; filename="x.csv"' },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:x",
    revokeObjectURL: () => undefined,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
  return fetcher;
}
const downloads = (fetcher: ReturnType<typeof stubDownloads>) =>
  fetcher.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.includes("/exports/"));

describe("ExportCard", () => {
  const mount = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ExportCard />
      </QueryClientProvider>,
    );

  it("downloads each file, sending the dates only with the transactions", async () => {
    const fetcher = stubDownloads();
    mount();
    const user = userEvent.setup();
    const transactions = screen.getByRole("button", {
      name: "Download transactions",
    });
    await waitFor(() => expect(transactions).toHaveProperty("disabled", false));
    await user.type(screen.getByLabelText("From date"), "2026-10-01");
    await user.click(transactions);
    await screen.findByText("Your file is ready.");
    await user.click(screen.getByRole("button", { name: "Download accounts" }));
    await user.click(
      screen.getByRole("button", { name: "Download categories" }),
    );
    await waitFor(() => expect(downloads(fetcher)).toHaveLength(3));
    expect(downloads(fetcher)).toEqual([
      `/api/v1/ledgers/${ledgerId}/exports/transactions.csv?from=2026-10-01`,
      `/api/v1/ledgers/${ledgerId}/exports/accounts.csv`,
      `/api/v1/ledgers/${ledgerId}/exports/categories.csv`,
    ]);
  });

  it("says in one line the file is not kept and blocks a backwards date range", async () => {
    stubDownloads();
    mount();
    const user = userEvent.setup();
    expect(screen.getByText(/not kept on the server/i)).toBeTruthy();
    expect(screen.queryByText(/open in any spreadsheet/)).toBeNull();
    await user.type(screen.getByLabelText("From date"), "2026-10-09");
    await user.type(screen.getByLabelText("To date"), "2026-10-01");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download transactions" }),
    ).toHaveProperty("disabled", true);
  });

  it("is the Export part of the page: a heading, the dates and three downloads, with no Import link", () => {
    stubDownloads();
    mount();
    expect(screen.getByRole("heading", { name: "Export" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Import from CSV" })).toBeNull();
    expect(screen.queryByText("Bring data in")).toBeNull();
  });

  it("keeps the accounts and categories files available when the range is backwards", async () => {
    stubDownloads();
    mount();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("From date"), "2026-10-09");
    await user.type(screen.getByLabelText("To date"), "2026-10-01");
    const accounts = screen.getByRole("button", { name: "Download accounts" });
    await waitFor(() => expect(accounts).toHaveProperty("disabled", false));
    expect(
      screen.getByRole("button", { name: "Download categories" }),
    ).toHaveProperty("disabled", false);
  });

  it("shows the API's message when a download fails", async () => {
    stubDownloads(true);
    mount();
    const accounts = screen.getByRole("button", { name: "Download accounts" });
    await waitFor(() => expect(accounts).toHaveProperty("disabled", false));
    await userEvent.click(accounts);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Ledger not found.",
    );
  });
});

describe("ExportButton", () => {
  it("exports with the filters it is given", async () => {
    const fetcher = stubDownloads();
    render(
      <ExportButton
        ledgerId={ledgerId}
        filters={{ categoryId: "c1", status: "pending" }}
        disabled={false}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await screen.findByText("Your file is ready.");
    expect(downloads(fetcher)).toEqual([
      `/api/v1/ledgers/${ledgerId}/exports/transactions.csv?categoryId=c1&status=pending`,
    ]);
  });

  it("has no explanation beside it", () => {
    stubDownloads();
    render(<ExportButton ledgerId={ledgerId} filters={{}} disabled={false} />);
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled();
    expect(screen.queryByText(/Saves the entries/)).toBeNull();
  });

  it("is off while the ledger is loading or the range is invalid", () => {
    stubDownloads();
    const { rerender } = render(
      <ExportButton ledgerId={undefined} filters={{}} disabled={false} />,
    );
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
    rerender(<ExportButton ledgerId={ledgerId} filters={{}} disabled />);
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });
});
