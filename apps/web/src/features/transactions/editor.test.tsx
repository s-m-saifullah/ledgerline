import { type Account, newId, type Transaction } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { category, json, ledgerId } from "../categories/fixtures.test-helper";
import { PrivacyContext } from "../shell/preferences";
import { TransactionEditor } from "./editor";

const food = category("Food");
const bank = {
  id: newId(),
  ledgerId,
  name: "Bank",
  archivedAt: null,
} as Account;
const row: Transaction = {
  id: newId(),
  ledgerId,
  accountId: bank.id,
  categoryId: food.id,
  kind: "expense",
  date: "2026-10-07",
  time: "14:30",
  amount: { amount: -123, currency: "USD" },
  baseAmount: { amount: -123, currency: "USD" },
  fxRate: 1,
  transferId: null,
  receivablePaymentId: null,
  receivableId: null,
  isSplit: false,
  splits: [],
  status: "cleared",
  payee: "Shop",
  note: null,
  version: 1,
  createdAt: "2026-10-07T00:00:00Z",
  updatedAt: "2026-10-07T00:00:00Z",
};
const props = {
  ledgerId,
  transaction: row,
  accounts: [bank],
  categories: [food],
  writable: true,
  open: true,
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
it("preserves an uncertain edit across close/resume and freezes the original key, body and version", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Disconnected"))
    .mockResolvedValueOnce(json({ ...row, version: 2, payee: "Correction" }));
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = client();
  const wrapper = ({ open }: { open: boolean }) => (
    <QueryClientProvider client={queryClient}>
      <TransactionEditor {...props} open={open} />
    </QueryClientProvider>
  );
  const view = render(wrapper({ open: true }));
  await userEvent.clear(screen.getByLabelText("Payee"));
  await userEvent.type(screen.getByLabelText("Payee"), "Correction");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(
    await screen.findByText(/couldn't confirm this action/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Payee")).toBeDisabled();
  view.rerender(wrapper({ open: false }));
  view.rerender(wrapper({ open: true }));
  await userEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
  expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
    fetchMock.mock.calls[0]?.[1]?.body,
  );
  expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
    fetchMock.mock.calls[0]?.[1]?.headers,
  );
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
    expectedVersion: 1,
    payee: "Correction",
    amount: { amount: -123, currency: "USD" },
    time: "14:30",
  });
});
it("requires latest details after a stale conflict and saves with the new version", async () => {
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
      <TransactionEditor {...props} />
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
  expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
    expectedVersion: 3,
    time: null,
  });
});
it("confirms deletion and retries its original expected version and key", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("Disconnected"))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={client()}>
      <TransactionEditor {...props} />
    </QueryClientProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Delete transaction" }),
  );
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Retry delete" }),
  );
  await waitFor(() => expect(props.onDeleted).toHaveBeenCalledWith(row));
  expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual(
    fetchMock.mock.calls[0]?.[1]?.headers,
  );
  expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"expectedVersion":1}');
});
it("retains archived historical assignments, masks money and prevents viewer writes", () => {
  render(
    <QueryClientProvider client={client()}>
      <PrivacyContext value={true}>
        <TransactionEditor
          {...props}
          accounts={[{ ...bank, archivedAt: row.createdAt }]}
          categories={[{ ...food, archivedAt: row.createdAt }]}
          writable={false}
        />
      </PrivacyContext>
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("Amount (USD)")).toHaveAttribute(
    "type",
    "password",
  );
  expect(screen.getByLabelText("Account", { exact: true })).toHaveValue(
    bank.id,
  );
  expect(screen.getByLabelText("Category", { exact: true })).toHaveValue(
    "Food (archived)",
  );
  expect(screen.getByLabelText("Amount (USD)")).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Save changes" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete transaction" }),
  ).not.toBeInTheDocument();
});
