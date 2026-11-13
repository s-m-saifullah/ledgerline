import {
  type Account,
  type Category,
  type Contact,
  newId,
  type Receipt,
  type ReceiptPreview as ReceiptPreviewData,
  type Receivable,
} from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyContext } from "../../../lib/preferences";
import { derivePayment } from "./derive";
import type { OperationForm } from "./form-context";
import {
  renderActionOperation,
  renderContactFields,
  renderPaymentOperation,
  renderReceiptOperation,
  renderServiceFields,
} from "./sections";
import { type ClientOperation, fieldsFor } from "./types";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
afterEach(cleanup);

const ledgerId = newId();
const stamp = "2026-10-01T00:00:00.000Z";
const money = (amount: number, currency = "USD") => ({ amount, currency });
const usd = (amount: number) => ({ amount, currency: "USD" as const });
const client = (name: string, over: Partial<Contact> = {}): Contact => ({
  id: newId(),
  ledgerId,
  name,
  phone: null,
  email: null,
  note: null,
  origin: "client",
  archivedAt: null,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  openBalance: usd(0),
  openBalances: [],
  unconvertedCurrencies: [],
  oldestOpenServiceDate: null,
  paidThisMonth: { base: usd(0), amounts: [] },
  ...over,
});
const sam = client("Sam", {
  openBalance: usd(30000),
  openBalances: [money(30000)],
});
const service = (over: Partial<Receivable> = {}): Receivable => ({
  id: newId(),
  ledgerId,
  contactId: sam.id,
  description: "Website work",
  serviceDate: "2026-10-07",
  serviceTime: null,
  dueDate: null,
  amount: money(30000),
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  received: money(0),
  remaining: money(30000),
  outstanding: money(30000),
  status: "unpaid",
  writtenOffAt: null,
  writtenOffAmount: null,
  writeOffReason: null,
  ...over,
});
const account = (name: string, currency = "USD", over = {}) =>
  ({ id: newId(), name, currency, archivedAt: null, ...over }) as Account;
const income = (name: string) =>
  ({
    id: newId(),
    name,
    kind: "income",
    parentId: null,
    sortOrder: 0,
    archivedAt: null,
    version: 1,
  }) as Category;

type Setup = {
  op: ClientOperation;
  accounts?: Account[];
  categories?: Category[];
  clients?: Contact[];
  currencies?: string[];
  privateMode?: boolean;
  writable?: boolean;
  preview?: ReceiptPreviewData | undefined;
  previewError?: boolean;
};
const checking = account("Checking");
const euro = account("Euro account", "EUR");
const services = income("Services");

function Harness(setup: Setup) {
  const { op } = setup;
  const [values, setValues] = useState(() => fieldsFor(op));
  const accounts = setup.accounts ?? [checking, euro];
  const derived = derivePayment(op, values, accounts);
  const writable = setup.writable ?? true;
  const form: OperationForm = {
    ledgerId,
    writable,
    frozen: false,
    allowWrite: writable,
    privateMode: setup.privateMode ?? false,
    values,
    setValues,
    accounts: { data: accounts },
    categories: { data: setup.categories ?? [services] },
    clients: { data: setup.clients ?? [sam] },
    currencies: setup.currencies ?? ["USD"],
    preview: { data: setup.preview, isError: setup.previewError ?? false },
    previewCents: derived.previewCents,
    derived,
  };
  return (
    <QueryClientProvider client={new QueryClient()}>
      <PrivacyContext value={form.privateMode}>
        <fieldset>
          {op.kind === "contact" && renderContactFields(form)}
          {op.kind === "service" && renderServiceFields(form, op)}
          {op.kind === "payment" && renderPaymentOperation(form, op)}
          {op.kind === "receipt" && renderReceiptOperation(form, op)}
          {op.kind === "action" && renderActionOperation(form, op)}
        </fieldset>
      </PrivacyContext>
    </QueryClientProvider>
  );
}
const show = (setup: Setup) => render(<Harness {...setup} />);
const labelsOf = (container: HTMLElement) =>
  [...container.querySelectorAll("label")].map((label) =>
    (label.textContent ?? "").trim(),
  );

describe("Add or edit client (OV['client-form'])", () => {
  it("asks for Name, Email, Phone and Note in the prototype's order, the note in a text area", () => {
    const { container } = show({ op: { kind: "contact" } });
    expect(labelsOf(container)).toEqual(["Name", "Email", "Phone", "Note"]);
    expect(screen.getByLabelText("Note").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Note")).toHaveProperty("maxLength", 2000);
    expect(screen.getByLabelText("Email")).toHaveProperty("type", "email");
    expect(screen.getByLabelText("Name")).toHaveProperty("required", true);
  });

  it("fills the fields of the client being edited", () => {
    const edited = client("Ana", { email: "ana@example.com", phone: "555" });
    show({ op: { kind: "contact", client: edited } });
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Ana");
    expect(screen.getByLabelText("Email")).toHaveProperty(
      "value",
      "ana@example.com",
    );
    expect(screen.getByLabelText("Phone")).toHaveProperty("value", "555");
  });
});

describe("Log or edit service (OV.service)", () => {
  it("names the client and marks the time and the due date Optional", () => {
    show({ op: { kind: "service", client: sam } });
    expect(screen.getByText("Client: Sam")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect(screen.getByLabelText("Service date")).toBeTruthy();
    expect(screen.getByLabelText("Time (Optional)")).toBeTruthy();
    expect(screen.getByLabelText("Due date (Optional)")).toBeTruthy();
    expect(screen.getByLabelText("Service amount (USD)")).toBeTruthy();
    expect(screen.queryByLabelText("Service time (optional)")).toBeNull();
  });

  it("offers neither a currency nor a move to another client when logging with one currency", () => {
    show({ op: { kind: "service", client: sam } });
    expect(screen.queryByLabelText("Currency")).toBeNull();
    expect(screen.queryByLabelText("Move to another client")).toBeNull();
  });

  it("offers the currency as a pick row only with a second currency", () => {
    show({
      op: { kind: "service", client: sam },
      currencies: ["USD", "EUR"],
    });
    const pick = screen.getByLabelText("Currency");
    expect(pick.tagName).toBe("SELECT");
    expect(pick.closest(".ui-pick-row")).toBeTruthy();
    expect(pick).toHaveProperty("disabled", false);
  });

  it("keeps the currency fixed once a payment exists and says why in one line", () => {
    const paid = service({
      amount: money(30000, "EUR"),
      received: money(1000, "EUR"),
    });
    show({
      op: { kind: "service", client: sam, service: paid },
      currencies: ["USD", "EUR"],
    });
    expect(screen.getByLabelText("Currency")).toHaveProperty("disabled", true);
    expect(
      screen.getByText("It stays EUR, the currency payments were recorded in."),
    ).toBeTruthy();
  });

  it("moves a service to another client only on edit, never to an archived one", () => {
    const ana = client("Ana");
    const old = client("Old", { archivedAt: stamp });
    show({
      op: { kind: "service", client: sam, service: service() },
      clients: [sam, ana, old],
    });
    const pick = screen.getByLabelText("Move to another client");
    expect(pick.closest(".ui-pick-row")).toBeTruthy();
    expect(
      [...pick.querySelectorAll("option")].map((option) => option.textContent),
    ).toEqual(["Sam", "Ana"]);
  });

  it("works out an hourly total, fills the amount and the blank description", () => {
    show({ op: { kind: "service", client: sam } });
    const fold = screen
      .getByText("Paid by the hour? Work out the amount")
      .closest("details");
    expect(fold?.open).toBe(false);
    fireEvent.change(screen.getByLabelText("Hours"), {
      target: { value: "3.5" },
    });
    fireEvent.change(screen.getByLabelText("Hourly rate (USD)"), {
      target: { value: "40" },
    });
    expect(screen.getByRole("status").textContent).toContain(
      "3.5 h at $40.00/h = $140.00",
    );
    fireEvent.click(screen.getByRole("button", { name: "Use this total" }));
    expect(screen.getByLabelText("Service amount (USD)")).toHaveProperty(
      "value",
      "140.00",
    );
    expect(screen.getByLabelText("Description")).toHaveProperty(
      "value",
      "3.5 h at $40.00/h",
    );
  });

  it("hides the amount from the screen in privacy mode", () => {
    show({ op: { kind: "service", client: sam }, privateMode: true });
    expect(screen.getByLabelText("Service amount (USD)")).toHaveProperty(
      "type",
      "password",
    );
  });
});

describe("Record or edit one payment (OV['pay-service'], OV['payment-edit'])", () => {
  const owed = service();
  it("shows the service with its client and what is outstanding, and the big amount prefilled", () => {
    show({ op: { kind: "payment", service: owed, client: sam } });
    const row = screen.getByText("Website work").closest(".ui-row");
    expect(row?.textContent).toContain("Client: Sam");
    expect(row?.textContent).toContain("Outstanding");
    expect(row?.textContent).toContain("$300.00");
    const amount = screen.getByLabelText("Payment amount (USD)");
    expect(amount).toHaveProperty("value", "300.00");
    expect(amount.closest(".entry-amount")).toBeTruthy();
  });

  it("masks the outstanding amount and the amount box in privacy mode", () => {
    show({
      op: { kind: "payment", service: owed, client: sam },
      privateMode: true,
    });
    const row = screen.getByText("Website work").closest(".ui-row");
    expect(row?.textContent).not.toContain("$300.00");
    expect(screen.getByLabelText("Payment amount (USD)")).toHaveProperty(
      "type",
      "password",
    );
  });

  it("takes the receiving account from a pick row and the category from the entry sheet's combo box", () => {
    show({ op: { kind: "payment", service: owed, client: sam } });
    const pick = screen.getByLabelText("Receiving account");
    expect(pick.tagName).toBe("SELECT");
    expect(pick.closest(".ui-pick-row")).toBeTruthy();
    expect(
      [...pick.querySelectorAll("option")].map((option) => option.textContent),
    ).toEqual(["Choose account", "Checking", "Euro account"]);
    expect(
      screen.getByRole("combobox", { name: "Category for the payment" }),
    ).toBeTruthy();
  });

  it("keeps date, time and note in a closed fold named Date, time and note when recording", () => {
    show({ op: { kind: "payment", service: owed, client: sam } });
    const fold = screen.getByText("Date, time and note").closest("details");
    expect(fold?.open).toBe(false);
    expect(
      within(fold as HTMLElement).getByLabelText("Payment date"),
    ).toBeTruthy();
    expect(
      within(fold as HTMLElement).getByLabelText("Time (Optional)"),
    ).toBeTruthy();
    expect(
      within(fold as HTMLElement).getByLabelText("Payment note"),
    ).toBeTruthy();
    expect(screen.queryByText(/More details/)).toBeNull();
  });

  it("shows the fields of a saved payment flat, with no fold", () => {
    const saved = {
      id: newId(),
      transaction: {
        accountId: checking.id,
        categoryId: services.id,
        amount: money(10000),
        date: "2026-10-08",
        time: null,
        note: "Deposit",
      },
      amount: money(10000),
      tip: null,
    } as unknown as NonNullable<
      Extract<ClientOperation, { kind: "payment" }>["payment"]
    >;
    const { container } = show({
      op: { kind: "payment", service: owed, client: sam, payment: saved },
    });
    expect(container.querySelector("details")).toBeNull();
    // What is outstanding is for recording; a correction shows the service and its client only.
    expect(screen.queryByText("Outstanding")).toBeNull();
    expect(screen.getByLabelText("Payment note")).toHaveProperty(
      "value",
      "Deposit",
    );
    expect(screen.getByLabelText("Payment amount (USD)")).toHaveProperty(
      "value",
      "100.00",
    );
  });

  it("explains a tip as the amount goes over what is owed", () => {
    show({ op: { kind: "payment", service: owed, client: sam } });
    expect(screen.queryByText(/saved as a tip/)).toBeNull();
    expect(screen.queryByText("Category for the tip")).toBeNull();
    fireEvent.change(screen.getByLabelText("Payment amount (USD)"), {
      target: { value: "320" },
    });
    expect(screen.getByRole("status").textContent).toBe(
      "This settles $300.00. The extra $20.00 is saved as a tip: separate income that does not change what is owed.",
    );
    expect(
      screen.getByRole("combobox", { name: "Category for the tip" }),
    ).toBeTruthy();
  });

  it("asks what arrived, and for a tip inside the fold, when the account uses another currency", () => {
    show({ op: { kind: "payment", service: owed, client: sam } });
    fireEvent.change(screen.getByLabelText("Receiving account"), {
      target: { value: euro.id },
    });
    expect(screen.getByLabelText("Amount received (EUR)")).toBeTruthy();
    const fold = screen
      .getByText("Tip, date, time and note")
      .closest("details") as HTMLElement;
    expect(within(fold).getByLabelText("Tip (EUR, optional)")).toBeTruthy();
    expect(screen.queryByText(/Extra money received/)).toBeNull();
  });

  it("tells a viewer to reopen a written-off service and keeps the fields disabled", () => {
    const written = service({ status: "writtenOff" });
    show({
      op: { kind: "payment", service: written, client: sam },
      writable: false,
    });
    expect(
      screen.getByText(
        "Reopen this service in Clients before correcting its payments.",
      ),
    ).toBeTruthy();
  });

  it("links to Categories when there is no income category and to Accounts when there is no account", () => {
    show({
      op: { kind: "payment", service: owed, client: sam },
      categories: [],
      accounts: [],
    });
    expect(
      screen
        .getByRole("link", { name: "Add income categories" })
        .getAttribute("href"),
    ).toBe("/categories");
    expect(
      screen
        .getByRole("link", { name: "Set up a receiving account" })
        .getAttribute("href"),
    ).toBe("/accounts");
  });
});

describe("Record payment from a client, and edit a receipt (OV.receive, OV['receipt-edit'])", () => {
  const owing = client("Sam", {
    openBalance: usd(30000),
    openBalances: [money(30000)],
  });
  const preview = (over: Partial<ReceiptPreviewData> = {}) =>
    ({
      amount: money(20000),
      openTotal: money(30000),
      exceedsBalance: false,
      tooManyServices: false,
      allocations: [
        {
          receivableId: newId(),
          description: "Logo",
          serviceDate: "2026-10-01",
          applied: money(10000),
          remainingAfter: money(0),
        },
        {
          receivableId: newId(),
          description: "Site",
          serviceDate: "2026-10-02",
          applied: money(10000),
          remainingAfter: money(20000),
        },
      ],
      ...over,
    }) as ReceiptPreviewData;

  it("shows the client with the open balance, and the big amount, and Pay full balance fills it", () => {
    show({ op: { kind: "receipt", client: owing } });
    const row = screen.getByText("Sam").closest(".ui-row");
    expect(row?.textContent).toContain("Open balance $300.00");
    const amount = screen.getByLabelText("Payment amount (USD)");
    expect(amount.closest(".entry-amount")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pay full balance" }));
    expect(amount).toHaveProperty("value", "300.00");
  });

  it("asks which currency is being paid only when the client owes in two", () => {
    show({ op: { kind: "receipt", client: owing } });
    expect(screen.queryByLabelText("Currency being paid")).toBeNull();
    cleanup();
    const both = client("Sam", {
      openBalances: [money(30000), money(5000, "EUR")],
    });
    show({ op: { kind: "receipt", client: both } });
    const pick = screen.getByLabelText("Currency being paid");
    expect(pick.closest(".ui-pick-row")).toBeTruthy();
    fireEvent.change(pick, { target: { value: "EUR" } });
    expect(screen.getByLabelText("Payment amount (EUR)")).toHaveProperty(
      "value",
      "",
    );
  });

  it("says what to do before an amount is typed", () => {
    show({ op: { kind: "receipt", client: owing } });
    fireEvent.change(screen.getByLabelText("Payment amount (USD)"), {
      target: { value: "" },
    });
    expect(
      screen.getByText(
        "Enter an amount to see which services it pays, oldest first.",
      ),
    ).toBeTruthy();
  });

  it("lists what the amount pays, oldest first, one row each with a hint", () => {
    const { container } = show({
      op: { kind: "receipt", client: owing },
      preview: preview(),
    });
    fireEvent.change(screen.getByLabelText("Payment amount (USD)"), {
      target: { value: "200" },
    });
    expect(screen.getByText("Pays, oldest first")).toBeTruthy();
    const rows = container.querySelectorAll(".receipt-preview .ui-row");
    expect(
      [...rows].map((row) => row.querySelector(".ui-row-title")?.textContent),
    ).toEqual(["Logo", "Site"]);
    expect(rows[0]?.textContent).toContain("Paid in full");
    expect(rows[1]?.textContent).toContain("$200.00 left");
    expect(rows[1]?.textContent).toContain("$100.00");
    // The amount is the shared money component, not the old one with its own size and margin.
    expect(container.querySelector(".receipt-preview .amount")).toBeNull();
    expect(
      screen.getByText("Pays 1 service in full and part of one more."),
    ).toBeTruthy();
  });

  it("names each refusal of the preview", () => {
    show({
      op: { kind: "receipt", client: owing },
      preview: preview({ exceedsBalance: true }),
      previewError: false,
    });
    fireEvent.change(screen.getByLabelText("Payment amount (USD)"), {
      target: { value: "200" },
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "That is more than the open balance of $300.00.",
    );
    cleanup();
    show({
      op: { kind: "receipt", client: owing },
      preview: preview({ tooManyServices: true }),
    });
    fireEvent.change(screen.getByLabelText("Payment amount (USD)"), {
      target: { value: "200" },
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "This would cover more than 100 services. Record a smaller payment first.",
    );
    cleanup();
    show({
      op: { kind: "receipt", client: owing },
      previewError: true,
    });
    fireEvent.change(screen.getByLabelText("Payment amount (USD)"), {
      target: { value: "200" },
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not preview this payment. Check the amount.",
    );
  });

  it("keeps the preview in privacy mode without amounts", () => {
    const { container } = show({
      op: { kind: "receipt", client: owing },
      preview: preview(),
      privateMode: true,
    });
    fireEvent.change(screen.getByLabelText("Payment amount (USD)"), {
      target: { value: "200" },
    });
    expect(container.textContent).not.toContain("$200.00");
    expect(container.textContent).not.toContain("$300.00");
  });

  it("edits a receipt as one line, a card and a note, with no amount box", () => {
    const receipt = {
      id: newId(),
      amount: money(80000),
      payments: [
        {
          id: newId(),
          version: 1,
          tip: null,
          transaction: {
            accountId: checking.id,
            categoryId: services.id,
            amount: money(30000),
            date: "2026-10-21",
            time: null,
            note: null,
          },
          receivable: service(),
        },
        {
          id: newId(),
          version: 1,
          tip: null,
          transaction: {},
          receivable: service(),
        },
        {
          id: newId(),
          version: 1,
          tip: null,
          transaction: {},
          receivable: service(),
        },
      ],
    } as unknown as Receipt;
    const { container } = show({
      op: { kind: "receipt", client: owing, receipt },
    });
    expect(
      screen.getByText(
        "Receipt total $800.00, split across 3 services. Changes apply to every payment in it.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "To change the amount, delete the receipt and enter it again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Payment amount/)).toBeNull();
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByLabelText("Payment date")).toHaveProperty(
      "value",
      "2026-10-21",
    );
  });
});

describe("What each rule leaves out, and who may type", () => {
  it("says the currency stays only when a payment fixed it", () => {
    show({
      op: { kind: "service", client: sam, service: service() },
      currencies: ["USD", "EUR"],
    });
    expect(screen.queryByText(/It stays/)).toBeNull();
  });

  it("keeps the description a person typed when the hours are used", () => {
    show({ op: { kind: "service", client: sam } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Site visit" },
    });
    fireEvent.change(screen.getByLabelText("Hours"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Hourly rate (USD)"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this total" }));
    expect(screen.getByLabelText("Description")).toHaveProperty(
      "value",
      "Site visit",
    );
    expect(screen.getByLabelText("Service amount (USD)")).toHaveProperty(
      "value",
      "20.00",
    );
  });

  it("focuses the amount by the id the sheet opens on", () => {
    show({ op: { kind: "payment", service: service(), client: sam } });
    expect(screen.getByLabelText("Payment amount (USD)").id).toBe(
      "client-amount",
    );
  });

  it("asks for a tip only when the account is in another currency", () => {
    show({ op: { kind: "payment", service: service(), client: sam } });
    fireEvent.change(screen.getByLabelText("Receiving account"), {
      target: { value: checking.id },
    });
    expect(screen.getByText("Date, time and note")).toBeTruthy();
    expect(screen.queryByText("Tip, date, time and note")).toBeNull();
    expect(screen.queryByLabelText(/^Tip/)).toBeNull();
    expect(screen.queryByLabelText(/^Amount received/)).toBeNull();
  });

  it("offers no link to Categories to someone who may not add one", () => {
    show({
      op: { kind: "payment", service: service(), client: sam },
      categories: [],
      writable: false,
    });
    expect(screen.queryByText(/There are no income categories yet/)).toBeNull();
  });

  it("names an archived account only when the payment already uses it", () => {
    const old = account("Old savings", "USD", { archivedAt: stamp });
    const saved = {
      id: newId(),
      transaction: {
        accountId: old.id,
        categoryId: services.id,
        amount: money(10000),
        date: "2026-10-08",
        time: null,
        note: null,
      },
      amount: money(10000),
      tip: null,
    } as unknown as NonNullable<
      Extract<ClientOperation, { kind: "payment" }>["payment"]
    >;
    show({
      op: { kind: "payment", service: service(), client: sam, payment: saved },
      accounts: [
        checking,
        old,
        account("Other archived", "USD", { archivedAt: stamp }),
      ],
    });
    expect(
      [
        ...screen
          .getByLabelText("Receiving account")
          .querySelectorAll("option"),
      ].map((option) => option.textContent),
    ).toEqual(["Choose account", "Checking", "Old savings (archived)"]);
  });

  it("lets a viewer read the fields but not type in any of them", () => {
    show({
      op: { kind: "service", client: sam, service: service() },
      writable: false,
    });
    expect(screen.getByLabelText("Description")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("Service date")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("Service amount (USD)")).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("Questions (OV.confirm, CONFIRM)", () => {
  const owed = service();
  const ask = (
    action: Extract<ClientOperation, { kind: "action" }>["action"],
  ) =>
    show({
      op: { kind: "action", action, client: sam, service: owed },
    });
  it.each([
    [
      "deleteContact",
      "Delete a client only after their services are deleted. Archive keeps the history.",
    ],
    ["archive", "Their history stays readable."],
    ["deleteService", "Delete a service only after its payments are deleted."],
    ["writeOff", "Waives only what is unpaid. Money received stays."],
    ["reopen", "Puts the waived remainder back as owed."],
    [
      "deletePayment",
      "Deletes the payment, its income entry and any tip together.",
    ],
    [
      "deleteReceipt",
      "Deletes every payment it made, their income entries and any tip together.",
    ],
  ] as const)("says %s in one sentence", (action, sentence) => {
    ask(action);
    expect(screen.getByText(sentence)).toBeTruthy();
  });

  it("asks for a reason only when writing off", () => {
    ask("deleteService");
    expect(screen.queryByLabelText("Write-off reason")).toBeNull();
    cleanup();
    ask("writeOff");
    expect(screen.getByLabelText("Write-off reason")).toHaveProperty(
      "maxLength",
      2000,
    );
  });

  it("says what Unarchive and the Undo restores do, in one sentence each", () => {
    ask("unarchive");
    expect(screen.getByText("Their history is active again.")).toBeTruthy();
    cleanup();
    ask("restoreReceipt");
    expect(
      screen.getByText("Puts back every payment, income entry and tip."),
    ).toBeTruthy();
  });
});
