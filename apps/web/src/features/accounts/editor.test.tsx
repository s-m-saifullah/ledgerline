import { type Account, newId } from "@ledgerline/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PrivacyContext } from "../../lib/preferences";
import { AccountEditor } from "./editor";

const ledgerId = newId();
const fixture: Account = {
  id: newId(),
  ledgerId,
  name: "My bank",
  type: "bank",
  currency: "USD",
  openingBalance: { amount: 120029, currency: "USD" },
  inboundBonusBps: null,
  bonusCategoryId: null,
  feeCategoryId: null,
  defaultFee: null,
  contactId: null,
  balance: { amount: 120029, currency: "USD" },
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("validates a name and saves debt in exact signed USD cents", async () => {
  const saved = vi.fn();
  const fetchMock = vi.fn<typeof fetch>(async () =>
    json(
      {
        ...fixture,
        name: "My loan",
        type: "loan",
        openingBalance: { amount: -4215, currency: "USD" },
      },
      201,
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AccountEditor
      ledgerId={ledgerId}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onAction={vi.fn()}
      onSaved={saved}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText("Give this account a name."),
  ).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText("Account name"), "My loan");
  await userEvent.selectOptions(screen.getByLabelText("Account type"), "loan");
  expect(screen.getByRole("radio", { name: "Money owed" })).toBeChecked();
  await userEvent.clear(screen.getByLabelText("Opening balance (USD)"));
  await userEvent.type(screen.getByLabelText("Opening balance (USD)"), "42.15");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    name: "My loan",
    type: "loan",
    openingBalance: { amount: -4215, currency: "USD" },
    inboundBonusBps: null,
    bonusCategoryId: null,
    feeCategoryId: null,
    defaultFee: null,
  });
});
it("retains the same prepared save when an interrupted form is closed and resumed", async () => {
  const saved = vi.fn();
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Connection lost"))
    .mockResolvedValue(json(fixture, 201));
  vi.stubGlobal("fetch", fetchMock);
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Resume
        </button>
        <AccountEditor
          ledgerId={ledgerId}
          open={open}
          onDismiss={() => setOpen(false)}
          onUnconfirmed={vi.fn()}
          onAction={vi.fn()}
          onSaved={saved}
        />
      </>
    );
  }
  render(<Host />);
  await userEvent.type(screen.getByLabelText("Account name"), "My bank");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText(/couldn't confirm the save/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Account name")).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Close for now" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(screen.getByLabelText("Account name")).toHaveValue("My bank");
  await userEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const [first, retry] = fetchMock.mock.calls.map((call) => call[1]);
  expect(retry?.body).toBe(first?.body);
  expect(new Headers(retry?.headers).get("Idempotency-Key")).toBe(
    new Headers(first?.headers).get("Idempotency-Key"),
  );
});
it("requires a reload after a stale edit and then uses the new version", async () => {
  const latest = { ...fixture, name: "Latest bank", version: 2 };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          detail: "This record changed.",
          errors: [{ field: "expectedVersion", message: "Reload." }],
        },
        409,
      ),
    )
    .mockResolvedValueOnce(json(latest))
    .mockResolvedValueOnce(json({ ...latest, name: "Updated", version: 3 }));
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  render(
    <AccountEditor
      ledgerId={ledgerId}
      account={fixture}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onAction={vi.fn()}
      onSaved={saved}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/This account changed/)).toBeInTheDocument();
  expect(screen.getByLabelText("Account name")).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Reload latest details" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Account name")).toHaveValue("Latest bank"),
  );
  await userEvent.clear(screen.getByLabelText("Account name"));
  await userEvent.type(screen.getByLabelText("Account name"), "Updated");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(
    JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).expectedVersion,
  ).toBe(2);
  expect(
    new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("Idempotency-Key"),
  ).not.toBe(
    new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Idempotency-Key"),
  );
});
it("masks the opening balance in privacy mode", () => {
  render(
    <PrivacyContext value={true}>
      <AccountEditor
        ledgerId={ledgerId}
        account={fixture}
        open
        onDismiss={vi.fn()}
        onUnconfirmed={vi.fn()}
        onAction={vi.fn()}
        onSaved={vi.fn()}
      />
    </PrivacyContext>,
  );
  expect(screen.getByLabelText("Opening balance (USD)")).toHaveAttribute(
    "type",
    "password",
  );
});

it("offers added currencies for a new account and reads the balance in that currency's units", async () => {
  const saved = vi.fn();
  const fetchMock = vi.fn<typeof fetch>(async () =>
    json(
      {
        ...fixture,
        name: "Yen wallet",
        currency: "JPY",
        openingBalance: { amount: 1500, currency: "JPY" },
        balance: { amount: 1500, currency: "JPY" },
      },
      201,
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AccountEditor
      ledgerId={ledgerId}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onAction={vi.fn()}
      onSaved={saved}
      currencies={["USD", "EUR", "JPY"]}
    />,
  );
  const choice = screen.getByLabelText("Currency");
  expect(
    Array.from(choice.querySelectorAll("option"), (option) => option.value),
  ).toEqual(["USD", "EUR", "JPY"]);
  await userEvent.type(screen.getByLabelText("Account name"), "Yen wallet");
  await userEvent.selectOptions(choice, "JPY");
  // The untouched balance restarts in the new currency's units, and the label follows.
  expect(screen.getByLabelText("Opening balance (JPY)")).toHaveValue("0");
  await userEvent.clear(screen.getByLabelText("Opening balance (JPY)"));
  // A currency without decimals takes no decimal point; the box refuses it as you type.
  await userEvent.type(screen.getByLabelText("Opening balance (JPY)"), "15.5");
  expect(screen.getByLabelText("Opening balance (JPY)")).toHaveValue("155");
  await userEvent.clear(screen.getByLabelText("Opening balance (JPY)"));
  await userEvent.type(screen.getByLabelText("Opening balance (JPY)"), "1500");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    name: "Yen wallet",
    type: "bank",
    openingBalance: { amount: 1500, currency: "JPY" },
    inboundBonusBps: null,
    bonusCategoryId: null,
    feeCategoryId: null,
    defaultFee: null,
  });
});

it("shows only the base currency to choose from when none are added, and fixes it when editing", () => {
  const { unmount } = render(
    <AccountEditor
      ledgerId={ledgerId}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onAction={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("Currency")).toBeNull();
  expect(screen.getByLabelText("Opening balance (USD)")).toBeInTheDocument();
  unmount();
  render(
    <AccountEditor
      ledgerId={ledgerId}
      account={{
        ...fixture,
        currency: "EUR",
        openingBalance: { amount: 1000, currency: "EUR" },
        balance: { amount: 1000, currency: "EUR" },
      }}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onAction={vi.fn()}
      onSaved={vi.fn()}
      currencies={["USD", "EUR"]}
    />,
  );
  // An account keeps its currency for life: a fixed row, not a choice.
  expect(screen.queryByLabelText("Currency")).toBeNull();
  expect(screen.getByText("Currency")).toBeInTheDocument();
  expect(screen.getByText("EUR")).toBeInTheDocument();
  expect(screen.getByLabelText("Opening balance (EUR)")).toHaveValue("10.00");
});
it("explains and sends a usual fee, fixed or as a percentage, with its category under More", async () => {
  const fees = {
    id: newId(),
    ledgerId,
    name: "Fees",
    kind: "expense" as const,
    parentId: null,
    icon: "utensils",
    color: "#0D9488",
    sortOrder: 0,
    archivedAt: null,
    version: 1,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
  };
  const fetchMock = vi.fn<typeof fetch>(async () => json(fixture, 201));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AccountEditor
      ledgerId={ledgerId}
      open
      categories={[fees]}
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onAction={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  expect(
    screen.getByText(/Type 2 for a fixed fee, or 2% for a percentage/),
  ).toBeInTheDocument();
  const more = screen.getByText(/^More/).closest("details");
  expect(more).not.toHaveAttribute("open");
  expect(more).toContainElement(screen.getByLabelText("Fee category"));
  await userEvent.type(screen.getByLabelText("Account name"), "Wallet");
  await userEvent.type(screen.getByLabelText("Usual fee"), "abc");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/percentage like 2%/)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.clear(screen.getByLabelText("Usual fee"));
  await userEvent.type(screen.getByLabelText("Usual fee"), "1.5%");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
    defaultFee: { basisPoints: 150 },
    feeCategoryId: null,
  });
});

it("offers Archive and Delete for an account that exists, and asks the page to open the question", async () => {
  const onAction = vi.fn();
  vi.stubGlobal("fetch", vi.fn());
  render(
    <AccountEditor
      ledgerId={ledgerId}
      account={fixture}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onAction={onAction}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Unarchive" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(onAction).toHaveBeenLastCalledWith("archive", fixture);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(onAction).toHaveBeenLastCalledWith("delete", fixture);
  expect(onAction).toHaveBeenCalledTimes(2);
});
it("says Unarchive for an archived account", async () => {
  const onAction = vi.fn();
  const archived = { ...fixture, archivedAt: "2026-10-07T00:00:00.000Z" };
  render(
    <AccountEditor
      ledgerId={ledgerId}
      account={archived}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onAction={onAction}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Archive" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Unarchive" }));
  expect(onAction).toHaveBeenCalledWith("unarchive", archived);
});
it("has no Archive or Delete on a new account", () => {
  render(
    <AccountEditor
      ledgerId={ledgerId}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
});
it("cannot archive or delete while the form is frozen by an unconfirmed save", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new TypeError("Connection lost"));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AccountEditor
      ledgerId={ledgerId}
      account={fixture}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/couldn't confirm the save/);
  expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
});
it("opens More when a bonus or fee problem is inside it", async () => {
  vi.stubGlobal("fetch", vi.fn());
  render(
    <AccountEditor
      ledgerId={ledgerId}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  const more = screen.getByText("More").closest("details");
  expect(more).not.toHaveAttribute("open");
  await userEvent.type(screen.getByLabelText("Account name"), "Wallet");
  await userEvent.type(screen.getByLabelText("Bonus rate (%)"), "500");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/between 0\.01 and 100/)).toBeInTheDocument();
  expect(more).toHaveAttribute("open");
});
it("shows the bonus category only once a bonus rate is typed", async () => {
  render(
    <AccountEditor
      ledgerId={ledgerId}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("Bonus category")).toBeNull();
  await userEvent.type(screen.getByLabelText("Bonus rate (%)"), "2.5");
  expect(screen.getByLabelText("Bonus category")).toBeInTheDocument();
});
it("flips the balance direction with the type until it is chosen by hand", async () => {
  render(
    <AccountEditor
      ledgerId={ledgerId}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByRole("radio", { name: "Money available" })).toBeChecked();
  await userEvent.selectOptions(screen.getByLabelText("Account type"), "card");
  expect(screen.getByRole("radio", { name: "Money owed" })).toBeChecked();
  // Choosing by hand keeps the choice when the type changes again.
  await userEvent.click(screen.getByRole("radio", { name: "Money owed" }));
  await userEvent.selectOptions(screen.getByLabelText("Account type"), "cash");
  expect(screen.getByRole("radio", { name: "Overdrawn" })).toBeChecked();
});
it("keeps the direction when the type of an existing account changes", async () => {
  render(
    <AccountEditor
      ledgerId={ledgerId}
      account={fixture}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByRole("radio", { name: "Money available" })).toBeChecked();
  await userEvent.selectOptions(screen.getByLabelText("Account type"), "card");
  // Only a new account follows the type; an existing one keeps the sign it was saved with.
  expect(screen.getByRole("radio", { name: "Credit" })).toBeChecked();
});
it("opens More when the usual fee has a problem", async () => {
  vi.stubGlobal("fetch", vi.fn());
  render(
    <AccountEditor
      ledgerId={ledgerId}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  const more = screen.getByText("More").closest("details");
  await userEvent.type(screen.getByLabelText("Account name"), "Wallet");
  await userEvent.type(screen.getByLabelText("Usual fee"), "abc");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(/percentage like 2%/)).toBeInTheDocument();
  expect(more).toHaveAttribute("open");
});
it("freezes Archive and Delete with the rest of the form while a save is unconfirmed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Connection lost")),
  );
  render(
    <AccountEditor
      ledgerId={ledgerId}
      account={fixture}
      open
      onDismiss={vi.fn()}
      onUnconfirmed={vi.fn()}
      onSaved={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/couldn't confirm the save/);
  expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
});
