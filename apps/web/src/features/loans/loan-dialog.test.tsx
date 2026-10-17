import {
  type Contact,
  type LoanBalance,
  type LoanPerson,
  newId,
} from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoanDialog } from "./loan-dialog";
import type { LoanAction } from "./loans-api";

const ledgerId = newId();
const stamp = "2026-10-01T00:00:00.000Z";
const bank = {
  id: newId(),
  ledgerId,
  name: "Everyday",
  type: "bank",
  currency: "USD",
  openingBalance: { amount: 100000, currency: "USD" },
  balance: { amount: 100000, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
};
const client: Contact = {
  id: newId(),
  ledgerId,
  name: "Sam",
  phone: null,
  email: null,
  note: null,
  origin: "loan",
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  openBalance: { amount: 0, currency: "USD" },
  openBalances: [],
  unconvertedCurrencies: [],
  oldestOpenServiceDate: null,
};
const loan = (amount: number): LoanBalance => ({
  accountId: newId(),
  currency: "USD",
  openingBalance: { amount: 0, currency: "USD" },
  balance: { amount, currency: "USD" },
  version: 3,
});
let queryClient: QueryClient;
afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllGlobals();
});
function mount(
  mode: LoanAction,
  loans: LoanBalance[],
  adding: { people: LoanPerson[] } | null = null,
) {
  const writes: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (init?.method === "POST" && url.endsWith("/contacts")) {
        writes.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ ...client, name: "Pat" }));
      }
      if (init?.method === "POST") {
        writes.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(
          JSON.stringify({
            balance: loan(30000),
            transferId: newId(),
            transactionId: null,
          }),
        );
      }
      if (url.includes("/accounts"))
        return new Response(
          JSON.stringify({ items: [bank], nextCursor: null }),
        );
      if (url.endsWith("/currencies"))
        return new Response(JSON.stringify({ baseCurrency: "USD", items: [] }));
      return new Response(JSON.stringify({ items: [], nextCursor: null }));
    }),
  );
  const saved = vi.fn();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <LoanDialog
        ledgerId={ledgerId}
        person={adding ? null : { id: client.id, name: client.name }}
        people={adding?.people ?? []}
        loans={loans}
        mode={mode}
        returnFocusId="main-content"
        onClose={() => {}}
        onSaved={saved}
      />
    </QueryClientProvider>,
  );
  return { writes, saved };
}

describe("LoanDialog", () => {
  it("lends from the chosen account and sends the amount in minor units", async () => {
    const { writes, saved } = mount("lend", []);
    await screen.findByRole("option", { name: "Everyday (USD)" });
    await userEvent.type(screen.getByLabelText(/Amount/), "300");
    await userEvent.click(screen.getByRole("button", { name: "Lend" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(writes[0]?.url).toContain(`/contacts/${client.id}/loans/lend`);
    expect(writes[0]?.body).toMatchObject({
      accountId: bank.id,
      amount: { amount: 30000, currency: "USD" },
    });
  });
  it("refuses a repayment larger than what is open, and sends nothing", async () => {
    const { writes } = mount("repay", [loan(10000)]);
    await screen.findByRole("option", { name: "Everyday (USD)" });
    await userEvent.type(screen.getByLabelText(/Amount/), "150");
    await userEvent.click(
      screen.getByRole("button", { name: "Record repayment" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "more than what is open",
    );
    expect(writes).toHaveLength(0);
  });
  it("adds an existing loan as a negative balance when you owe, with the loan's version", async () => {
    const { writes, saved } = mount("opening", [loan(5000)]);
    await userEvent.selectOptions(screen.getByLabelText("Who owes whom"), [
      "owedByMe",
    ]);
    await userEvent.type(screen.getByLabelText(/Amount/), "25");
    await userEvent.click(
      screen.getByRole("button", { name: "Save existing loan" }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(writes[0]?.body).toMatchObject({
      amount: { amount: -2500, currency: "USD" },
      expectedVersion: 3,
    });
  });
  it("adds a loan for a new person: creates them for Loans first, then lends", async () => {
    const { writes, saved } = mount("lend", [], { people: [] });
    await screen.findByRole("option", { name: "Everyday (USD)" });
    await userEvent.type(screen.getByLabelText("Name"), "Pat");
    await userEvent.type(screen.getByLabelText(/Amount/), "40");
    await userEvent.click(screen.getByRole("button", { name: "Lend" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(client.id));
    expect(writes[0]?.url).toMatch(/\/contacts$/);
    expect(writes[0]?.body).toEqual({ name: "Pat", origin: "loan" });
    expect(writes[1]?.url).toContain(`/contacts/${client.id}/loans/lend`);
  });
  it("asks who a loan is with when there are people to choose from", async () => {
    const sam: LoanPerson = {
      id: client.id,
      name: "Sam",
      origin: "loan",
      archivedAt: null,
      version: 1,
      balances: [],
    };
    const { writes } = mount("lend", [], { people: [sam] });
    await screen.findByRole("option", { name: "Everyday (USD)" });
    await userEvent.type(screen.getByLabelText(/Amount/), "10");
    await userEvent.click(screen.getByRole("button", { name: "Lend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose who this is with",
    );
    expect(writes).toHaveLength(0);
  });
  it("changes the balance from before Ledgerline for a person you already track", async () => {
    const sam: LoanPerson = {
      id: client.id,
      name: "Sam",
      origin: "loan",
      archivedAt: null,
      version: 1,
      balances: [loan(5000)],
    };
    const { writes, saved } = mount("opening", [], { people: [sam] });
    await userEvent.selectOptions(screen.getByLabelText(/^Who(?! owes)/), [
      sam.id,
    ]);
    await userEvent.type(screen.getByLabelText(/Amount/), "75");
    await userEvent.click(
      screen.getByRole("button", { name: "Save existing loan" }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalledWith(client.id));
    expect(writes[0]?.url).toContain(`/contacts/${client.id}/loans/opening`);
    expect(writes[0]?.body).toMatchObject({
      amount: { amount: 7500, currency: "USD" },
      expectedVersion: 3,
    });
  });
});
