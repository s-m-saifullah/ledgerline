import {
  type ExchangeRate,
  newId,
  type PinnedCurrency,
} from "@ledgerline/shared";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { today } from "../../lib/rate-format";
import { RateSheet } from "./rate-sheet";

const ledgerId = newId();
const stamp = "2026-10-10T00:00:00.000Z";
const rate = (
  value: string,
  source: "api" | "manual" = "api",
  date = "2026-10-09",
): ExchangeRate => ({
  id: newId(),
  ledgerId,
  code: "EUR",
  date,
  rate: value,
  source,
  version: 4,
  createdAt: stamp,
  updatedAt: stamp,
});
const pinned = (latestRate: ExchangeRate | null): PinnedCurrency => ({
  id: newId(),
  ledgerId,
  code: "EUR",
  version: 2,
  latestRate,
  createdAt: stamp,
  updatedAt: stamp,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
type Write = { method: string; body: unknown; key: string };
const problem = (status: number, detail: string) =>
  new Response(
    JSON.stringify({ type: "about:blank", title: "Problem", status, detail }),
    { status },
  );
function mount(
  currency: PinnedCurrency,
  reply: () => Response = () =>
    new Response(JSON.stringify(rate("0.8", "manual")), { status: 200 }),
) {
  const writes: Write[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_url, init) => {
      writes.push({
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
        key: new Headers(init?.headers).get("Idempotency-Key") ?? "",
      });
      return reply();
    }),
  );
  const onSaved = vi.fn();
  const onDismiss = vi.fn();
  render(
    <RateSheet
      ledgerId={ledgerId}
      baseCurrency="USD"
      currency={currency}
      onDismiss={onDismiss}
      onSaved={onSaved}
    />,
  );
  return { writes, onSaved, onDismiss };
}

it("shows the stored rate base first, where it came from and its date", async () => {
  mount(pinned(rate("0.00812", "manual")));
  const sheet = await screen.findByRole("dialog", { name: "Euro" });
  const rateRow = within(sheet).getByText("Rate").closest(".ui-row");
  expect(rateRow?.textContent).toContain("1 USD in EUR");
  expect(rateRow?.textContent).toContain("123.1527");
  const source = within(sheet).getByText("Source").closest(".ui-row");
  expect(source?.textContent).toContain("Set by you");
  expect(source?.textContent).toContain("2026-10-09");
  expect(within(sheet).getByLabelText("Set the rate yourself")).toHaveValue(
    "123.1527",
  );
});
it("says Fetched for an automatic rate and shows no source without a rate", async () => {
  mount(pinned(rate("1.1217", "api")));
  expect(await screen.findByText("Fetched")).toBeTruthy();
  cleanup();
  mount(pinned(null));
  const sheet = await screen.findByRole("dialog", { name: "Euro" });
  expect(within(sheet).getByText("None yet")).toBeTruthy();
  expect(within(sheet).queryByText("Source")).toBeNull();
  expect(within(sheet).getByLabelText("Set the rate yourself")).toHaveValue("");
});
it("saves the typed rate inverted, for today with an idempotency key, with no date to pick, then says Rate saved", async () => {
  const user = userEvent.setup();
  const { writes, onSaved } = mount(pinned(rate("1.1217")));
  const box = await screen.findByLabelText("Set the rate yourself");
  await user.clear(box);
  await user.type(box, "1.13");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Rate saved."));
  expect(screen.queryByText("More")).toBeNull();
  expect(screen.queryByLabelText("Date")).toBeNull();
  expect(writes[0]).toMatchObject({
    method: "PUT",
    body: { code: "EUR", date: today(), rate: "0.8849557522" },
  });
  expect(writes[0]?.key).not.toBe("");
});
it("edits today's stored rate, and adds today's when the latest is from another day", async () => {
  const user = userEvent.setup();
  const sheet = pinned(rate("1.1", "api", today()));
  const { writes } = mount(sheet);
  await user.click(await screen.findByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.body).toMatchObject({
    expectedVersion: 4,
  });
  cleanup();
  const other = mount(pinned(rate("1.1", "api", "2026-10-09")));
  await user.click(await screen.findByRole("button", { name: "Save" }));
  await waitFor(() => expect(other.writes).toHaveLength(1));
  expect(other.writes[0]?.body).not.toHaveProperty("expectedVersion");
});
it("rejects a bad rate before sending anything and names what to type", async () => {
  const user = userEvent.setup();
  const { writes } = mount(pinned(rate("1.1")));
  const box = await screen.findByLabelText("Set the rate yourself");
  await user.clear(box);
  await user.type(box, "1e3");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Enter how much EUR one USD is worth, such as 122.5.",
  );
  expect(box).toHaveAttribute("aria-invalid", "true");
  expect(writes).toHaveLength(0);
  await user.type(box, "5");
  expect(screen.queryByRole("alert")).toBeNull();
});
it("shows the server's words for a refusal and sends a new key next time", async () => {
  const user = userEvent.setup();
  const { writes, onSaved } = mount(pinned(rate("1.1")), () =>
    problem(409, "A rate cannot be set for a future date."),
  );
  await user.click(await screen.findByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A rate cannot be set for a future date.",
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
  expect(onSaved).not.toHaveBeenCalled();
});
it("repeats a save whose answer was lost with the same key", async () => {
  const user = userEvent.setup();
  let calls = 0;
  const { writes, onSaved } = mount(pinned(rate("1.1")), () => {
    calls += 1;
    return calls === 1
      ? problem(503, "Down")
      : new Response(JSON.stringify(rate("0.9", "manual")), { status: 200 });
  });
  await user.click(await screen.findByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't confirm that. Please try again.",
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(writes[1]?.key).toBe(writes[0]?.key);
});
it("asks before removing: Cancel keeps the sheet, Remove sends the version", async () => {
  const user = userEvent.setup();
  const { writes, onSaved } = mount(
    pinned(rate("1.1")),
    () => new Response(null, { status: 204 }),
  );
  await user.click(
    await screen.findByRole("button", { name: "Remove currency" }),
  );
  const question = await screen.findByRole("dialog", { name: "Remove EUR?" });
  expect(question).toHaveTextContent(
    "Its stored rates and the entries in it are kept.",
  );
  expect(writes).toHaveLength(0);
  await user.click(within(question).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Remove EUR?" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Euro" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Remove currency" }));
  await user.click(await screen.findByRole("button", { name: "Remove" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Removed EUR."));
  expect(writes[0]).toMatchObject({
    method: "DELETE",
    body: { expectedVersion: 2 },
  });
});
it("shows a failed removal inside the question", async () => {
  const user = userEvent.setup();
  mount(pinned(rate("1.1")), () => problem(409, "This currency changed."));
  await user.click(
    await screen.findByRole("button", { name: "Remove currency" }),
  );
  await user.click(await screen.findByRole("button", { name: "Remove" }));
  const question = await screen.findByRole("dialog", { name: "Remove EUR?" });
  expect(await within(question).findByRole("alert")).toHaveTextContent(
    "This currency changed.",
  );
});
it("treats a 500 as an unknown answer and repeats it with the same key", async () => {
  const user = userEvent.setup();
  let calls = 0;
  const { writes, onSaved } = mount(pinned(rate("1.1")), () => {
    calls += 1;
    return calls === 1
      ? problem(500, "Broke")
      : new Response(JSON.stringify(rate("0.9", "manual")), { status: 200 });
  });
  await user.click(await screen.findByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't confirm that. Please try again.",
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(writes[1]?.key).toBe(writes[0]?.key);
});
it("draws a rate you set in the accent and a fetched one in neutral", async () => {
  mount(pinned(rate("1.1", "manual")));
  expect((await screen.findByText("Set by you")).className).toContain(
    "ui-pill-accent",
  );
  cleanup();
  mount(pinned(rate("1.1", "api")));
  expect((await screen.findByText("Fetched")).className).toContain(
    "ui-pill-neutral",
  );
});
