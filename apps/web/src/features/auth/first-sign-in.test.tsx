import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { json } from "../../test-support/category-fixtures";
import { FirstSignIn } from "./first-sign-in";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Write = { url: string; method: string; body: unknown };
function mount({
  answer = (_write: Write): Response | undefined => undefined,
} = {}) {
  const writes: Write[] = [];
  const onSaved = vi.fn(async () => undefined);
  const onSignOut = vi.fn(async () => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const entry = {
        url: String(url),
        method: init?.method ?? "GET",
        body: JSON.parse(String(init?.body ?? "null")),
      };
      writes.push(entry);
      return answer(entry) ?? new Response(null, { status: 204 });
    }),
  );
  render(<FirstSignIn onSaved={onSaved} onSignOut={onSignOut} />);
  return { writes, onSaved, onSignOut };
}
const field = (label: string) => screen.getByLabelText(label);
const fill = async (
  user: ReturnType<typeof userEvent.setup>,
  temporary: string,
  next: string,
  confirm: string,
) => {
  if (temporary) await user.type(field("Temporary password"), temporary);
  if (next) await user.type(field("New password"), next);
  if (confirm) await user.type(field("Confirm New"), confirm);
};
const problem = (status: number, detail: string, fieldName?: string) =>
  json(
    {
      type: "about:blank",
      title: "x",
      status,
      detail,
      errors: fieldName ? [{ field: fieldName, message: detail }] : [],
    },
    status,
  );

it("is one centred card with no shell: a heading, three password rows, one button and Sign out", () => {
  mount();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Choose a new password",
  );
  expect(screen.getByRole("main")).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Save and continue" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  expect(document.title).toBe("New password · Ledgerline");
});

it("asks for the temporary password, then the new one twice, with the right autofill hints", () => {
  mount();
  const rows = ["Temporary password", "New password", "Confirm New"].map(field);
  for (const input of rows) expect(input).toHaveAttribute("type", "password");
  expect(rows.map((input) => input.getAttribute("autocomplete"))).toEqual([
    "current-password",
    "new-password",
    "new-password",
  ]);
  expect(field("New password")).toHaveAttribute(
    "placeholder",
    "12+ characters",
  );
});

it("says what the admin set only to a screen reader, and has no visible subtitle", () => {
  mount();
  const note = screen.getByText(
    "Your password was set by the admin. Choose your own to continue.",
  );
  expect(note).toHaveClass("sr-only");
});

it("starts on the first row", async () => {
  mount();
  await waitFor(() => expect(field("Temporary password")).toHaveFocus());
});

it("changes the password with the temporary one as the current one, signs the other devices out, then carries on", async () => {
  const user = userEvent.setup();
  const { writes, onSaved } = mount();
  await fill(
    user,
    "maple-otter-1234-river",
    "a brand new password",
    "a brand new password",
  );
  await user.click(screen.getByRole("button", { name: "Save and continue" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(writes).toEqual([
    {
      url: "/api/v1/me/password",
      method: "POST",
      body: {
        currentPassword: "maple-otter-1234-river",
        newPassword: "a brand new password",
        signOutOtherDevices: true,
      },
    },
  ]);
});

it("checks what it can on the rows, in order, without asking the server", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await user.click(screen.getByRole("button", { name: "Save and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Enter the temporary password you were given.",
  );
  expect(field("Temporary password")).toHaveAttribute("aria-invalid", "true");
  await user.type(field("Temporary password"), "maple-otter-1234-river");
  await user.type(field("New password"), "short");
  await user.click(screen.getByRole("button", { name: "Save and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Use 12 characters or more.",
  );
  expect(field("New password")).toHaveAttribute("aria-invalid", "true");
  await user.clear(field("New password"));
  await user.type(field("New password"), "a brand new password");
  await user.type(field("Confirm New"), "another password!");
  await user.click(screen.getByRole("button", { name: "Save and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The two new passwords are different.",
  );
  expect(field("Confirm New")).toHaveAttribute("aria-invalid", "true");
  expect(writes).toEqual([]);
  // Typing again clears the message.
  await user.type(field("Confirm New"), "x");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("puts the server's answer on the row it names and stays on the card", async () => {
  const user = userEvent.setup();
  const { onSaved } = mount({
    answer: () =>
      problem(400, "That password is not right.", "currentPassword"),
  });
  await fill(
    user,
    "maple-otter-1234-river",
    "a brand new password",
    "a brand new password",
  );
  await user.click(screen.getByRole("button", { name: "Save and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That password is not right.",
  );
  expect(field("Temporary password")).toHaveAttribute("aria-invalid", "true");
  await waitFor(() => expect(field("Temporary password")).toHaveFocus());
  expect(onSaved).not.toHaveBeenCalled();
});

it("never calls a lost answer a failure", async () => {
  const user = userEvent.setup();
  const { onSaved } = mount({ answer: () => json({}, 500) });
  await fill(
    user,
    "maple-otter-1234-river",
    "a brand new password",
    "a brand new password",
  );
  await user.click(screen.getByRole("button", { name: "Save and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't confirm that. Check your connection and try again.",
  );
  expect(onSaved).not.toHaveBeenCalled();
});

it("waits while saving: the button says so and cannot be pressed twice", async () => {
  const user = userEvent.setup();
  let release: (response: Response) => void = () => undefined;
  mount();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  );
  await fill(
    user,
    "maple-otter-1234-river",
    "a brand new password",
    "a brand new password",
  );
  await user.click(screen.getByRole("button", { name: "Save and continue" }));
  const busy = await screen.findByRole("button", { name: "Saving…" });
  expect(busy).toBeDisabled();
  // Nothing can be edited while the password is on its way.
  for (const label of ["Temporary password", "New password", "Confirm New"])
    expect(field(label)).toBeDisabled();
  release(new Response(null, { status: 204 }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeEnabled(),
  );
});

it("signs out, the one other way off the card", async () => {
  const user = userEvent.setup();
  const { writes, onSignOut } = mount();
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
  expect(writes).toEqual([
    { url: "/api/v1/auth/sign-out", method: "POST", body: {} },
  ]);
});

it("says so when signing out does not work, and does not leave", async () => {
  const user = userEvent.setup();
  const { onSignOut } = mount({ answer: () => json({}, 500) });
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't sign out. Please try again.",
  );
  expect(onSignOut).not.toHaveBeenCalled();
});
