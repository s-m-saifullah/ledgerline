import { type Account, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PrivacyContext } from "../shell/preferences";
import { AccountsPage } from "./accounts-page";

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
const account: Account = {
  id: newId(),
  ledgerId,
  name: "My card",
  type: "card",
  currency: "USD",
  openingBalance: { amount: -125050, currency: "USD" },
  balance: { amount: -125050, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
};
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
function mount(items: Account[], role = "owner", privacy = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes("/accounts")
              ? { items, nextCursor: null }
              : {
                  items: [
                    {
                      id: ledgerId,
                      name: "Personal",
                      baseCurrency: "USD",
                      role,
                    },
                  ],
                },
          ),
        ),
    ),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PrivacyContext value={privacy}>
        <AccountsPage />
      </PrivacyContext>
    </QueryClientProvider>,
  );
}
it("offers first-account setup with one primary action", async () => {
  mount([]);
  expect(
    await screen.findByText("A place for your money."),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Add.*account/ })).toHaveLength(
    1,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Add your first account" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Add account" }),
  ).toBeInTheDocument();
});
it("labels debt and removes actual balance text in privacy mode", async () => {
  mount([account], "owner", true);
  expect(await screen.findByText("My card")).toBeInTheDocument();
  expect(screen.getByText("Amount owed")).toBeInTheDocument();
  expect(screen.getByText("Amount hidden")).toBeInTheDocument();
  expect(screen.queryByText("$1,250.50")).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain("1,250");
});
it("permits viewer reads without exposing mutation controls", async () => {
  mount([account], "viewer");
  expect(await screen.findByText("$1,250.50")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Add.*account|Edit.*|Archive.*/ }),
  ).not.toBeInTheDocument();
});
