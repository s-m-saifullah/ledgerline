import { type LoanBalance, type LoanPerson, newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyContext } from "../../lib/preferences";
import { LoanDialog } from "./loan-dialog";
import type { LoanAction } from "./loans-api";

const ledgerId = newId();
const stamp = "2026-10-01T00:00:00.000Z";
const account = (name: string, currency: string) => ({
  id: newId(),
  ledgerId,
  name,
  type: "bank",
  currency,
  openingBalance: { amount: 0, currency },
  balance: { amount: 0, currency },
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
const everyday = account("Everyday", "USD");
const euros = account("Euro pot", "EUR");
const category = (name: string, kind: "expense" | "income") => ({
  id: newId(),
  ledgerId,
  name,
  kind,
  parentId: null,
  icon: "tag",
  color: "#0d9488",
  sortOrder: 0,
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
});
const bad = category("Bad debt", "expense");
const gift = category("Gift", "income");
const loan = (amount: number, currency = "USD"): LoanBalance => ({
  accountId: newId(),
  currency,
  openingBalance: { amount: 0, currency },
  balance: { amount, currency },
  version: 3,
});
const sam = { id: newId(), name: "Sam" };
type Write = { url: string; body: Record<string, unknown>; key: string | null };
let queryClient: QueryClient;
afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllGlobals();
});
function mount(
  props: {
    mode: LoanAction;
    loans?: LoanBalance[];
    people?: LoanPerson[] | null;
    editCurrency?: string;
    currencies?: string[];
    failFirst?: boolean;
    privacy?: boolean;
  } = { mode: "lend" },
) {
  const writes: Write[] = [];
  let failed = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      const url = String(target);
      if (init?.method === "POST") {
        writes.push({
          url,
          body: JSON.parse(String(init.body)),
          key: new Headers(init.headers).get("Idempotency-Key"),
        });
        if (props.failFirst && !failed && !url.endsWith("/contacts")) {
          failed = true;
          return new Response("{}", { status: 500 });
        }
        if (url.endsWith("/contacts"))
          return new Response(
            JSON.stringify({
              id: sam.id,
              ledgerId,
              name: "Pat",
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
              paidThisMonth: {
                base: { amount: 0, currency: "USD" },
                amounts: [],
              },
            }),
          );
        return new Response(
          JSON.stringify({
            balance: loan(1),
            transferId: null,
            transactionId: null,
          }),
        );
      }
      if (url.includes("/accounts"))
        return new Response(
          JSON.stringify({ items: [everyday, euros], nextCursor: null }),
        );
      if (url.includes("/categories"))
        return new Response(
          JSON.stringify({ items: [bad, gift], nextCursor: null }),
        );
      if (url.endsWith("/currencies"))
        return new Response(
          JSON.stringify({
            baseCurrency: "USD",
            items: (props.currencies ?? []).map((code) => ({
              id: newId(),
              ledgerId,
              code,
              version: 1,
              latestRate: null,
              createdAt: stamp,
              updatedAt: stamp,
            })),
          }),
        );
      return new Response(JSON.stringify({ items: [], nextCursor: null }));
    }),
  );
  const saved = vi.fn();
  const closed = vi.fn();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PrivacyContext value={props.privacy ?? false}>
        <LoanDialog
          ledgerId={ledgerId}
          person={props.people ? null : sam}
          people={props.people ?? []}
          loans={props.loans ?? []}
          mode={props.mode}
          editCurrency={props.editCurrency}
          returnFocusId="main-content"
          onClose={closed}
          onSaved={saved}
        />
      </PrivacyContext>
    </QueryClientProvider>,
  );
  return { writes, saved, closed };
}
const sheet = () => screen.getByRole("dialog");
const submitName = () =>
  within(sheet()).getAllByRole("button").at(-1)?.textContent;

describe("the sheet's words for each action", () => {
  it.each([
    ["lend", "Lend money to Sam", "A transfer, not spending.", "Lend"],
    ["borrow", "Borrow money from Sam", "A transfer, not income.", "Borrow"],
  ] as const)(
    "%s: title, one short line and the pinned word",
    async (mode, title, line, word) => {
      mount({ mode });
      const dialog = await screen.findByRole("dialog", { name: title });
      expect(within(dialog).getByText(line)).toBeTruthy();
      expect(submitName()).toBe(word);
    },
  );
  it("repay: says who owes how much, and the word Record repayment", async () => {
    mount({ mode: "repay", loans: [loan(12000)] });
    const dialog = await screen.findByRole("dialog", {
      name: "Record a repayment",
    });
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Sam owes you $120.00",
    );
    expect(submitName()).toBe("Record repayment");
  });
  it("lets a repayment be exactly what is open", async () => {
    const { writes, saved } = mount({ mode: "repay", loans: [loan(10000)] });
    await screen.findByRole("option", { name: "Everyday (USD)" });
    await userEvent.type(screen.getByLabelText(/^Amount/), "100.00");
    await userEvent.click(
      screen.getByRole("button", { name: "Record repayment" }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(writes[0]?.body).toMatchObject({
      amount: { amount: 10000, currency: "USD" },
    });
  });
  it("repay when you owe: the money goes out of the account you choose", async () => {
    mount({ mode: "repay", loans: [loan(-4000)] });
    await screen.findByRole("dialog", { name: "Record a repayment" });
    expect(screen.getByRole("status")).toHaveTextContent("You owe Sam $40.00");
    expect(screen.getByLabelText("Paid from")).toBeTruthy();
    expect(screen.queryByLabelText("Received into")).toBeNull();
  });
  it("repay when owed to you: the money comes into the account you choose", async () => {
    mount({ mode: "repay", loans: [loan(4000)] });
    await screen.findByRole("dialog", { name: "Record a repayment" });
    expect(screen.getByLabelText("Received into")).toBeTruthy();
  });
  it("lend pays from and borrow is received into", async () => {
    mount({ mode: "lend" });
    expect(await screen.findByLabelText("Paid from")).toBeTruthy();
    cleanup();
    mount({ mode: "borrow" });
    expect(await screen.findByLabelText("Received into")).toBeTruthy();
  });
  it("waive: says where it is recorded, by who owes whom, and has no amount box", async () => {
    mount({ mode: "waive", loans: [loan(500)] });
    const dialog = await screen.findByRole("dialog", {
      name: "Waive what is left",
    });
    expect(
      within(dialog).getByText(
        "Recorded as an expense in the category you choose.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText("Expense category")).toBeTruthy();
    expect(screen.queryByLabelText(/^Amount/)).toBeNull();
    expect(submitName()).toBe("Waive");
    cleanup();
    mount({ mode: "waive", loans: [loan(-500)] });
    await screen.findByRole("dialog", { name: "Waive what is left" });
    expect(
      screen.getByText("Recorded as income in the category you choose."),
    ).toBeTruthy();
    expect(screen.getByText("Income category")).toBeTruthy();
  });
  it("existing loan: changes no account, so there is no account row, date or note", async () => {
    mount({ mode: "opening", loans: [loan(100)], editCurrency: "USD" });
    const dialog = await screen.findByRole("dialog", {
      name: "Change the balance from before Ledgerline",
    });
    expect(within(dialog).getByText("Changes no account.")).toBeTruthy();
    expect(screen.queryByLabelText("Date")).toBeNull();
    expect(screen.queryByLabelText("Note (Optional)")).toBeNull();
    expect(screen.queryByLabelText("Paid from")).toBeNull();
    expect(submitName()).toBe("Save existing loan");
  });
  it("says what the existing balance is now and that later money stays on top", async () => {
    const before = {
      ...loan(0),
      openingBalance: { amount: 5000, currency: "USD" },
    };
    mount({ mode: "opening", loans: [before], editCurrency: "USD" });
    await screen.findByRole("dialog");
    expect(
      [...document.querySelectorAll(".ln-note")].map((n) => n.textContent),
    ).toContain(
      "This replaces the balance from before Ledgerline, currently owed to you $50.00. Money you lend or repay later stays on top of it.",
    );
  });
});

describe("Add loan", () => {
  const amy: LoanPerson = {
    id: newId(),
    name: "Amy",
    origin: "loan",
    archivedAt: null,
    version: 1,
    balances: [loan(2500)],
  };
  it("is titled Add loan, with three choices of what happened and nobody chosen", async () => {
    mount({ mode: "lend", people: [amy] });
    const dialog = await screen.findByRole("dialog", { name: "Add loan" });
    const group = within(dialog).getByRole("radiogroup", {
      name: "What happened",
    });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["I lent money", "I borrowed money", "A loan I already had"]);
    expect(
      within(group).getByRole("radio", { name: "I lent money" }),
    ).toBeChecked();
    expect(within(dialog).getByLabelText("Who")).toHaveValue("");
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Who")).toHaveFocus(),
    );
  });
  it("changes the pinned word and the line with the choice", async () => {
    mount({ mode: "lend", people: [amy] });
    const dialog = await screen.findByRole("dialog", { name: "Add loan" });
    expect(within(dialog).getByText("A transfer, not spending.")).toBeTruthy();
    expect(submitName()).toBe("Lend");
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "I borrowed money" }),
    );
    expect(within(dialog).getByText("A transfer, not income.")).toBeTruthy();
    expect(submitName()).toBe("Borrow");
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "A loan I already had" }),
    );
    expect(within(dialog).getByText("Changes no account.")).toBeTruthy();
    expect(submitName()).toBe("Save existing loan");
  });
  it("asks for a name only for a new person, and refuses an empty one", async () => {
    const { writes } = mount({ mode: "lend", people: [amy] });
    await screen.findByRole("dialog", { name: "Add loan" });
    expect(screen.queryByLabelText("Name")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Who"), "new");
    expect(screen.getByLabelText("Name")).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/^Amount/), "5");
    await userEvent.click(screen.getByRole("button", { name: "Lend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the person's name.",
    );
    expect(writes).toHaveLength(0);
  });
  it("lists archived people as such", async () => {
    const old = { ...amy, id: newId(), name: "Old", archivedAt: stamp };
    mount({ mode: "lend", people: [amy, old] });
    expect(
      await screen.findByRole("option", { name: "Old (archived)" }),
    ).toBeTruthy();
    expect(screen.getByRole("option", { name: "A new person…" })).toBeTruthy();
  });
  it("creates a new person only once even when the loan has to be retried", async () => {
    const { writes, saved } = mount({
      mode: "lend",
      people: [],
      failFirst: true,
    });
    await screen.findByRole("option", { name: "Everyday (USD)" });
    await userEvent.type(screen.getByLabelText("Name"), "Pat");
    await userEvent.type(screen.getByLabelText(/^Amount/), "10");
    await userEvent.click(screen.getByRole("button", { name: "Lend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save that. Please try again.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Lend" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(sam.id));
    const creates = writes.filter((w) => w.url.endsWith("/contacts"));
    expect(creates).toHaveLength(1);
    const lends = writes.filter((w) => w.url.endsWith("/loans/lend"));
    expect(lends).toHaveLength(2);
    expect(lends[1]?.key).toBe(lends[0]?.key);
  });
});

describe("what the form checks", () => {
  it("wants an amount in numbers, and one above zero", async () => {
    const { writes } = mount({ mode: "lend" });
    await screen.findByRole("option", { name: "Everyday (USD)" });
    await userEvent.click(screen.getByRole("button", { name: "Lend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter an amount using numbers only.",
    );
    await userEvent.type(screen.getByLabelText(/^Amount/), "0");
    await userEvent.click(screen.getByRole("button", { name: "Lend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter an amount greater than zero.",
    );
    expect(writes).toHaveLength(0);
  });
  it("wants a category to waive with", async () => {
    const { writes } = mount({ mode: "waive", loans: [loan(500)] });
    await screen.findByRole("dialog", { name: "Waive what is left" });
    await userEvent.click(screen.getByRole("button", { name: "Waive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a category.",
    );
    expect(writes).toHaveLength(0);
  });
  it("sends the waive with the chosen category, the date and the note", async () => {
    const { writes, saved } = mount({ mode: "waive", loans: [loan(500)] });
    const dialog = await screen.findByRole("dialog", {
      name: "Waive what is left",
    });
    await userEvent.click(within(dialog).getByRole("combobox"));
    await userEvent.click(
      await screen.findByRole("option", { name: "Bad debt" }),
    );
    await userEvent.type(
      within(dialog).getByLabelText("Note (Optional)"),
      "  Forgiven ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Waive" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(writes[0]?.url).toMatch(/\/loans\/waive$/);
    expect(writes[0]?.body).toMatchObject({
      currency: "USD",
      categoryId: bad.id,
      note: "Forgiven",
    });
  });
  it("only offers income categories when you owe, and expense ones when you are owed", async () => {
    mount({ mode: "waive", loans: [loan(-500)] });
    const dialog = await screen.findByRole("dialog", {
      name: "Waive what is left",
    });
    await userEvent.click(within(dialog).getByRole("combobox"));
    expect(await screen.findByRole("option", { name: "Gift" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Bad debt" })).toBeNull();
  });
});

describe("several currencies", () => {
  it("lets a repayment choose among the open currencies only", async () => {
    mount({
      mode: "repay",
      loans: [loan(1000), loan(-2000, "EUR"), loan(0, "GBP")],
    });
    await screen.findByRole("dialog", { name: "Record a repayment" });
    const pick = screen.getByLabelText("Currency");
    expect(
      within(pick)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["USD", "EUR"]);
    await userEvent.selectOptions(pick, "EUR");
    expect(screen.getByRole("status")).toHaveTextContent("You owe Sam €20.00");
    expect(screen.getByLabelText(/^Amount \(EUR\)/)).toBeTruthy();
  });
  it("has no currency row with one choice", async () => {
    mount({ mode: "repay", loans: [loan(1000)] });
    await screen.findByRole("dialog", { name: "Record a repayment" });
    expect(screen.queryByLabelText("Currency")).toBeNull();
  });
  it("lends in the currency of the chosen account", async () => {
    const { writes, saved } = mount({ mode: "lend" });
    await screen.findByRole("option", { name: "Euro pot (EUR)" });
    await userEvent.selectOptions(screen.getByLabelText("Paid from"), euros.id);
    await userEvent.type(screen.getByLabelText(/^Amount \(EUR\)/), "8");
    await userEvent.click(screen.getByRole("button", { name: "Lend" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(writes[0]?.body).toMatchObject({
      accountId: euros.id,
      amount: { amount: 800, currency: "EUR" },
    });
  });
  it("a repayment can only use an account in the loan's currency", async () => {
    mount({ mode: "repay", loans: [loan(1000)] });
    await screen.findByRole("option", { name: "Everyday (USD)" });
    expect(screen.queryByRole("option", { name: "Euro pot (EUR)" })).toBeNull();
  });
  it("lets an existing loan choose any ledger currency when adding", async () => {
    mount({ mode: "opening", people: [], currencies: ["EUR"] });
    await screen.findByRole("dialog", { name: "Add loan" });
    await waitFor(() =>
      expect(screen.queryByLabelText("Currency")).not.toBeNull(),
    );
    expect(
      within(screen.getByLabelText("Currency"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["USD", "EUR"]);
  });
});

describe("the big amount", () => {
  it("has its label for a screen reader and hides the digits in privacy mode", async () => {
    mount({ mode: "lend", privacy: true });
    const box = await screen.findByLabelText("Amount (USD)");
    expect(box).toHaveAttribute("type", "password");
  });
});

describe("Add loan folds the parts it does not need instead of dropping them", () => {
  const amy: LoanPerson = {
    id: newId(),
    name: "Amy",
    origin: "loan",
    archivedAt: null,
    version: 1,
    balances: [],
  };
  const fold = (label: string) =>
    screen.getByLabelText(label).closest(".ln-fold") as HTMLElement;
  it("keeps the account, date and note in the page but shut and unreachable for a loan I already had", async () => {
    mount({ mode: "lend", people: [amy] });
    const dialog = await screen.findByRole("dialog", { name: "Add loan" });
    expect(fold("Date").dataset.shut).toBe("false");
    expect(fold("Date")).not.toHaveAttribute("inert");
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "A loan I already had" }),
    );
    expect(fold("Date").dataset.shut).toBe("true");
    expect(fold("Date")).toHaveAttribute("inert");
    expect(fold("Paid from")).toBe(fold("Date"));
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "I borrowed money" }),
    );
    expect(fold("Date").dataset.shut).toBe("false");
    expect(fold("Date")).not.toHaveAttribute("inert");
  });
  it("says They owe me until someone is chosen, then uses their name", async () => {
    mount({ mode: "opening", people: [amy] });
    const dialog = await screen.findByRole("dialog", { name: "Add loan" });
    expect(
      within(dialog).getByRole("radio", { name: "They owe me" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("radio", { name: "I owe them" }),
    ).toBeTruthy();
    await userEvent.selectOptions(within(dialog).getByLabelText("Who"), amy.id);
    expect(
      within(dialog).getByRole("radio", { name: "Amy owes me" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("radio", { name: "I owe Amy" }),
    ).toBeTruthy();
  });
  it("opens Who owes whom only for a loan I already had", async () => {
    mount({ mode: "lend", people: [amy] });
    const dialog = await screen.findByRole("dialog", { name: "Add loan" });
    const direction = () =>
      within(dialog)
        .getByRole("radiogroup", { name: "Who owes whom", hidden: true })
        .closest(".ln-fold") as HTMLElement;
    expect(direction().dataset.shut).toBe("true");
    expect(direction()).toHaveAttribute("inert");
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "A loan I already had" }),
    );
    expect(direction().dataset.shut).toBe("false");
    expect(direction()).not.toHaveAttribute("inert");
  });
  it("opens the currency row only when there is a choice of currencies", async () => {
    mount({ mode: "lend", people: [], currencies: ["EUR"] });
    const dialog = await screen.findByRole("dialog", { name: "Add loan" });
    const currency = () =>
      screen
        .getByLabelText("Currency", { selector: "select" })
        .closest(".ln-fold") as HTMLElement;
    expect(currency().dataset.shut).toBe("true");
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "A loan I already had" }),
    );
    await waitFor(() => expect(currency().dataset.shut).toBe("false"));
  });
  it("does not send the date or note for a loan I already had", async () => {
    const { writes, saved } = mount({ mode: "lend", people: [amy] });
    const dialog = await screen.findByRole("dialog", { name: "Add loan" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Who"), amy.id);
    await userEvent.click(
      within(dialog).getByRole("radio", { name: "A loan I already had" }),
    );
    await userEvent.type(within(dialog).getByLabelText(/^Amount/), "12");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save existing loan" }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(writes[0]?.url).toMatch(/\/loans\/opening$/);
    expect(writes[0]?.body).toEqual({
      amount: { amount: 1200, currency: "USD" },
    });
  });
  it("leaves the parts out of a sheet opened for one action, where nothing changes", async () => {
    mount({ mode: "opening", loans: [loan(100)], editCurrency: "USD" });
    await screen.findByRole("dialog");
    expect(document.querySelector(".ln-fold")).toBeNull();
  });
});
