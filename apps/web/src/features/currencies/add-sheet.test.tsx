import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AddCurrencySheet } from "./add-sheet";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
type Write = { url: string; body: unknown; key: string };
function mount(
  reply: (url: string) => Response = (url) =>
    url.endsWith("/currencies")
      ? new Response("{}", { status: 500 })
      : new Response("{}", { status: 500 }),
  taken: string[] = ["EUR"],
) {
  const writes: Write[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      writes.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        key: new Headers(init?.headers).get("Idempotency-Key") ?? "",
      });
      return reply(String(url));
    }),
  );
  const onSaved = vi.fn();
  render(
    <AddCurrencySheet
      ledgerId="00000000-0000-7000-8000-000000000001"
      baseCurrency="USD"
      taken={taken}
      onDismiss={() => {}}
      onSaved={onSaved}
    />,
  );
  return { writes, onSaved };
}
const problem = (status: number, detail: string) =>
  new Response(
    JSON.stringify({ type: "about:blank", title: "Problem", status, detail }),
    { status },
  );

it("offers every currency but the base and those added, as Name (CODE)", async () => {
  mount();
  const choice = (await screen.findByLabelText(
    "Currency",
  )) as HTMLSelectElement;
  const values = [...choice.options].map((option) => option.value);
  expect(values[0]).toBe("");
  expect(choice.options[0]?.textContent).toBe("Choose…");
  expect(values).toContain("GBP");
  expect(values).not.toContain("USD");
  expect(values).not.toContain("EUR");
  expect(
    [...choice.options].find((option) => option.value === "GBP")?.textContent,
  ).toBe("British Pound (GBP)");
});
it("asks for a choice before sending anything", async () => {
  const { writes } = mount();
  await userEvent.click(
    await screen.findByRole("button", { name: "Add currency" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Choose a currency.",
  );
  expect(writes).toHaveLength(0);
  await userEvent.selectOptions(screen.getByLabelText("Currency"), "GBP");
  expect(screen.queryByRole("alert")).toBeNull();
});
it("keeps working when the rate cannot be fetched: the currency is still added", async () => {
  const { writes, onSaved } = mount((url) =>
    url.endsWith("/currencies")
      ? new Response(
          JSON.stringify({
            id: "00000000-0000-7000-8000-000000000002",
            ledgerId: "00000000-0000-7000-8000-000000000001",
            code: "GBP",
            version: 1,
            latestRate: null,
            createdAt: "2026-10-10T00:00:00.000Z",
            updatedAt: "2026-10-10T00:00:00.000Z",
          }),
          { status: 201 },
        )
      : problem(502, "No source"),
  );
  await userEvent.selectOptions(
    await screen.findByLabelText("Currency"),
    "GBP",
  );
  await userEvent.click(screen.getByRole("button", { name: "Add currency" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("Added GBP."));
  expect(writes).toHaveLength(2);
  expect(writes[0]?.body).toEqual({ code: "GBP" });
});
it("shows a refusal, and repeats a lost answer with the same key", async () => {
  let calls = 0;
  const { writes, onSaved } = mount((url) => {
    calls += 1;
    if (!url.endsWith("/currencies")) return problem(502, "No source");
    return calls === 1
      ? problem(503, "Down")
      : new Response(
          JSON.stringify({
            id: "00000000-0000-7000-8000-000000000002",
            ledgerId: "00000000-0000-7000-8000-000000000001",
            code: "GBP",
            version: 1,
            latestRate: null,
            createdAt: "2026-10-10T00:00:00.000Z",
            updatedAt: "2026-10-10T00:00:00.000Z",
          }),
          { status: 201 },
        );
  });
  await userEvent.selectOptions(
    await screen.findByLabelText("Currency"),
    "GBP",
  );
  await userEvent.click(screen.getByRole("button", { name: "Add currency" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't confirm that. Please try again.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Add currency" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(writes[1]?.key).toBe(writes[0]?.key);
});
it("shows the server's words when it refuses and takes a new key after", async () => {
  const { writes } = mount(() =>
    problem(409, "This currency is already added."),
  );
  await userEvent.selectOptions(
    await screen.findByLabelText("Currency"),
    "GBP",
  );
  await userEvent.click(screen.getByRole("button", { name: "Add currency" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This currency is already added.",
  );
  await userEvent.click(screen.getByRole("button", { name: "Add currency" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]?.key).not.toBe(writes[0]?.key);
});
