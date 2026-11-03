import { newId } from "@ledgerline/shared";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonDialog } from "./person-dialog";

const ledgerId = newId();
const sam = {
  id: newId(),
  name: "Sam",
  version: 7,
  phone: "555-0100",
  email: "sam@example.com",
  note: "Neighbour",
};
type Write = { url: string; method: string; body: unknown; key: string | null };
const contact = (name: string) =>
  JSON.stringify({
    ...sam,
    name,
    ledgerId,
    origin: "loan",
    archivedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    openBalance: { amount: 0, currency: "USD" },
    openBalances: [],
    unconvertedCurrencies: [],
    oldestOpenServiceDate: null,
    paidThisMonth: { base: { amount: 0, currency: "USD" }, amounts: [] },
  });
const problem = (status: number, detail: string) =>
  new Response(
    JSON.stringify({ type: "about:blank", title: "Error", status, detail }),
    { status },
  );
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount(
  action: "rename" | "archive" | "unarchive",
  replies: Response[] = [],
) {
  const writes: Write[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
      writes.push({
        url: String(target),
        method: String(init?.method),
        body: JSON.parse(String(init?.body)),
        key: new Headers(init?.headers).get("Idempotency-Key"),
      });
      return replies.shift() ?? new Response(contact("Samira"));
    }),
  );
  const saved = vi.fn();
  const closed = vi.fn();
  render(
    <PersonDialog
      ledgerId={ledgerId}
      person={sam}
      action={action}
      returnFocusId="main-content"
      onClose={closed}
      onSaved={saved}
    />,
  );
  return { writes, saved, closed };
}

describe("Rename", () => {
  it("is a sheet with the name filled in, and sends the trimmed name with the person's other details and version", async () => {
    const { writes, saved } = mount("rename");
    const sheet = await screen.findByRole("dialog", { name: "Rename" });
    const field = within(sheet).getByLabelText("Name");
    expect(field).toHaveValue("Sam");
    expect(
      within(sheet).getByText(
        "The name also changes on their balance account.",
      ),
    ).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, "  Samira ");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Save name" }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("PATCH");
    expect(writes[0]?.url).toContain(`/contacts/${sam.id}`);
    expect(writes[0]?.body).toEqual({
      name: "Samira",
      phone: "555-0100",
      email: "sam@example.com",
      note: "Neighbour",
      expectedVersion: 7,
    });
  });
  it("refuses an empty name and sends nothing", async () => {
    const { writes } = mount("rename");
    const field = await screen.findByLabelText("Name");
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the person's name.",
    );
    expect(writes).toHaveLength(0);
  });
  it("starts with the name field focused", async () => {
    mount("rename");
    const field = await screen.findByLabelText("Name");
    await waitFor(() => expect(field).toHaveFocus());
  });
  it("retries an unconfirmed save with the same key, and starts a new request after a refusal", async () => {
    const { writes, saved } = mount("rename", [
      new Response("{}", { status: 500 }),
      problem(409, "Someone changed this person."),
    ]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Save name" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save that. Please try again.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(
      await screen.findByText("Someone changed this person."),
    ).toBeTruthy();
    expect(writes[1]?.key).toBe(writes[0]?.key);
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(writes[2]?.key).not.toBe(writes[1]?.key);
  });
  it("cancels without saving", async () => {
    const { writes, closed } = mount("rename");
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );
    expect(closed).toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe("Archive and Unarchive", () => {
  it("asks first, in a centred question with one word on its button", async () => {
    const { writes, saved } = mount("archive");
    const question = await screen.findByRole("dialog", {
      name: "Archive Sam?",
    });
    expect(question.className).toContain("ui-question");
    expect(
      within(question).getByText(
        "Balances and history are kept. No new loans until you unarchive.",
      ),
    ).toBeTruthy();
    expect(writes).toHaveLength(0);
    await userEvent.click(
      within(question).getByRole("button", { name: "Archive" }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(writes[0]?.method).toBe("POST");
    expect(writes[0]?.url).toMatch(new RegExp(`/contacts/${sam.id}/archive$`));
    expect(writes[0]?.body).toEqual({ expectedVersion: 7 });
  });
  it("unarchives with its own sentence and word", async () => {
    const { writes, saved } = mount("unarchive");
    const question = await screen.findByRole("dialog", {
      name: "Unarchive Sam?",
    });
    expect(
      within(question).getByText("You can lend and borrow again."),
    ).toBeTruthy();
    await userEvent.click(
      within(question).getByRole("button", { name: "Unarchive" }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(writes[0]?.url).toMatch(/\/unarchive$/);
  });
  it("says so when it could not save, and keeps the question open", async () => {
    const { saved } = mount("archive", [new Response("{}", { status: 500 })]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Archive" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save that. Please try again.",
    );
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Archive Sam?" })).toBeTruthy();
  });
});
