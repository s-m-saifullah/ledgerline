import { type Account, newId, type Transfer } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json, ledgerId } from "../categories/fixtures.test-helper";
import { PrivacyContext } from "../shell/preferences";
import { TransferForm } from "./transfer-form";

const from = {
    id: newId(),
    ledgerId,
    name: "Bank",
    archivedAt: null,
  } as Account,
  to = { id: newId(), ledgerId, name: "Cash", archivedAt: null } as Account;
const row: Transfer = {
  id: newId(),
  ledgerId,
  fromAccountId: from.id,
  toAccountId: to.id,
  fromTransactionId: newId(),
  toTransactionId: newId(),
  amount: { amount: 123, currency: "USD" },
  date: "2026-10-07",
  time: "09:05",
  note: null,
  version: 1,
  createdAt: "2026-10-07T00:00:00Z",
  updatedAt: "2026-10-07T00:00:00Z",
};
const props = {
  ledgerId,
  transfer: row,
  accounts: [from, to],
  open: true,
  writable: true,
  onDismiss: vi.fn(),
  onSaved: vi.fn(),
  onDeleted: vi.fn(),
  onLock: vi.fn(),
};
const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("retains immutable transfer edit across close/resume even after choices disappear", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Disconnected"))
    .mockResolvedValueOnce(json({ ...row, version: 2 }));
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = client();
  const wrapper = (open: boolean, accounts = props.accounts) => (
    <QueryClientProvider client={queryClient}>
      <TransferForm {...props} open={open} accounts={accounts} />
    </QueryClientProvider>
  );
  const view = render(wrapper(true));
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(
    await screen.findByText(/couldn't confirm this transfer/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("From account")).toBeDisabled();
  view.rerender(wrapper(false));
  view.rerender(wrapper(true, []));
  await userEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  expect(fetchMock.mock.calls[1]?.[1]).toEqual(fetchMock.mock.calls[0]?.[1]);
});
it("reloads stale transfer details before a fresh expected-version write", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json({ title: "Conflict", detail: "Changed", errors: [] }, 409),
    )
    .mockResolvedValueOnce(json({ ...row, version: 3, time: null }))
    .mockResolvedValueOnce(json({ ...row, version: 4, time: null }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={client()}>
      <TransferForm {...props} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Reload latest details" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Time (optional)")).toHaveValue(""),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  expect(
    JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).expectedVersion,
  ).toBe(3);
});
it("retries paired deletion with its original key/version", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Disconnected"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={client()}>
      <TransferForm {...props} />
    </QueryClientProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Delete transfer" }),
  );
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Retry delete" }),
  );
  await waitFor(() => expect(props.onDeleted).toHaveBeenCalled());
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
    `/transfers/${row.id}`,
  );
  expect(fetchMock.mock.calls[1]?.[1]).toEqual(fetchMock.mock.calls[0]?.[1]);
});
it("masks amount and permits read-only historical archived details", () => {
  render(
    <QueryClientProvider client={client()}>
      <PrivacyContext value={true}>
        <TransferForm
          {...props}
          writable={false}
          accounts={[{ ...from, archivedAt: "2026-10-07T00:00:00Z" }, to]}
        />
      </PrivacyContext>
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("Amount (USD)")).toHaveAttribute(
    "type",
    "password",
  );
  expect(screen.getByLabelText("From account")).toBeDisabled();
  expect(screen.getByText("Bank (archived)")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete transfer" }),
  ).not.toBeInTheDocument();
});
