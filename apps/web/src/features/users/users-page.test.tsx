import { newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { json } from "../../test-support/category-fixtures";
import { type PageAdd, PageAddProvider } from "../shell/page-add";
import { UsersPage } from "./users-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className} {...rest}>
      {children}
    </a>
  ),
}));

const adminId = newId();
const person = (over: Record<string, unknown> = {}) => ({
  // Absent unless a test sets it, as an older server leaves it out.
  ledgerClearedAt: undefined as string | null | undefined,
  id: newId(),
  name: "Jordan Lee",
  email: "jordan@example.com",
  isAdmin: false,
  mustChangePassword: false,
  disabled: false,
  twoFactorEnabled: false,
  createdAt: "2026-11-03T10:00:00.000Z",
  ...over,
});
const sam = person({
  id: adminId,
  name: "Sam Lee",
  email: "sam@example.com",
  isAdmin: true,
  twoFactorEnabled: true,
});
const jordan = person({ twoFactorEnabled: true });
const riley = person({
  name: "Riley Park",
  email: "riley@example.com",
  mustChangePassword: true,
});
const casey = person({
  name: "Casey Ng",
  email: "casey@example.com",
  disabled: true,
});
const DAY = 24 * 60 * 60 * 1000;
/** A person in Recently deleted whose 30 days end `days` days from now (a part of a day counts as a whole one). */
const gone = (name: string, email: string, days: number) => ({
  id: newId(),
  name,
  email,
  deletedAt: new Date(Date.now() + days * DAY - 30 * DAY).toISOString(),
  purgeAt: new Date(Date.now() + days * DAY).toISOString(),
});
const taylor = gone("Taylor Brooks", "taylor@example.com", 22.5);
const morgan = gone("Morgan Diaz", "morgan@example.com", 2.5);
const meOf = (over: Record<string, unknown> = {}) => ({
  id: adminId,
  name: "Sam Lee",
  email: "sam@example.com",
  isAdmin: true,
  mustChangePassword: false,
  twoFactorEnabled: true,
  ...over,
});
const problem = (status: number, detail: string) =>
  json({ type: "about:blank", title: "x", status, detail, errors: [] }, status);

type Write = { url: string; method: string; body: unknown };
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});

function mount({
  people = [sam, jordan, riley, casey],
  deleted = [] as unknown[],
  deletedFails = false,
  me = meOf(),
  write = (_write: Write): Response | undefined => undefined,
} = {}) {
  const writes: Write[] = [];
  const reads: string[] = [];
  let pageAdd: PageAdd | null = null;
  const state = { people, deleted };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const path = String(url);
      if (init?.method && init.method !== "GET") {
        const entry = {
          url: path,
          method: init.method,
          body: JSON.parse(String(init.body ?? "null")),
        };
        writes.push(entry);
        const custom = write(entry);
        if (custom) return custom;
        if (entry.method === "POST" && path.endsWith("/users")) {
          const added = person({
            name: (entry.body as { name: string }).name,
            email: (entry.body as { email: string }).email,
            mustChangePassword: true,
          });
          state.people = [...state.people, added];
          return json(added, 201);
        }
        if (entry.method === "PATCH") return json(jordan);
        return new Response(null, { status: 204 });
      }
      reads.push(path);
      if (path.endsWith("/me")) return json(me);
      if (path.endsWith("/users/deleted"))
        return deletedFails ? json({}, 500) : json({ items: state.deleted });
      if (path.endsWith("/users")) return json({ items: state.people });
      return json({});
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PageAddProvider
        value={(add) => {
          pageAdd = add;
        }}
      >
        <UsersPage />
      </PageAddProvider>
    </QueryClientProvider>,
  );
  return { writes, reads, pageAdd: () => pageAdd, state };
}
const sheet = () => screen.getByRole("dialog");
const row = (name: RegExp) => screen.findByRole("button", { name });
const passwordShown = () =>
  within(sheet()).getByTestId("temporary-password").textContent ?? "";

it("lists every person: name, email and one pill, in the order the server sends them", async () => {
  mount();
  const you = await screen.findByRole("link", { name: /Sam Lee/ });
  expect(you).toHaveAttribute("href", "/profile");
  expect(you).toHaveTextContent("sam@example.com");
  expect(you).toHaveTextContent("Admin");
  expect(you).toHaveTextContent("You");
  expect(await row(/Jordan Lee/)).toHaveTextContent("jordan@example.com");
  expect(await row(/Jordan Lee/)).not.toHaveTextContent(
    /Admin|Disabled|Temporary/,
  );
  expect(await row(/Riley Park/)).toHaveTextContent("Temporary password");
  expect(await row(/Casey Ng/)).toHaveTextContent("Disabled");
  const names = [...document.querySelectorAll(".ui-row-title")].map(
    (title) => title.textContent,
  );
  expect(names).toEqual(["Sam Lee", "Jordan Lee", "Riley Park", "Casey Ng"]);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Users");
});

it("has no subtitle, and a row says no more than a title and one short hint", async () => {
  mount();
  await row(/Jordan Lee/);
  for (const hint of document.querySelectorAll(".ui-row-hint"))
    expect((hint.textContent ?? "").length).toBeLessThan(40);
  expect(document.querySelector(".page-heading p")).toBeNull();
});

it("shows only the admin their own row's way to Profile: it is a link, never an actions sheet", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("link", { name: /Sam Lee/ }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("tells anyone but the admin that this page is not theirs, and never asks the server for the list", async () => {
  const { reads } = mount({ me: meOf({ isAdmin: false }) });
  expect(
    await screen.findByText("Only the admin can manage users."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Add user/ })).toBeNull();
  await waitFor(() =>
    expect(reads.some((read) => read.endsWith("/me"))).toBe(true),
  );
  expect(reads.some((read) => read.endsWith("/users"))).toBe(false);
});

it("offers to try again when it cannot be checked who is signed in", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => json({}, 500)),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't check who you are.",
  );
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("says so, with an Add user button, when only the admin has an account", async () => {
  mount({ people: [sam] });
  expect(
    await screen.findByText("Only you have an account."),
  ).toBeInTheDocument();
  const user = userEvent.setup();
  const buttons = screen.getAllByRole("button", { name: "Add user" });
  await user.click(buttons[buttons.length - 1] as HTMLElement);
  expect(sheet()).toHaveAccessibleName("Add user");
});

it("shows no empty message when there are other people", async () => {
  mount();
  await row(/Jordan Lee/);
  expect(screen.queryByText("Only you have an account.")).toBeNull();
});

it("offers to try again when the list cannot be read", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/me") ? json(meOf()) : json({}, 500),
    ),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't load the list.",
  );
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("gives a phone's one Add button the job of adding a user, for the admin only", async () => {
  const { pageAdd } = mount();
  await row(/Jordan Lee/);
  expect(pageAdd()).toMatchObject({ label: "Add user", disabled: false });
  const user = userEvent.setup();
  pageAdd()?.onClick();
  expect(await screen.findByRole("dialog")).toHaveAccessibleName("Add user");
  await user.click(within(sheet()).getByRole("button", { name: "Cancel" }));
});

it("registers no phone Add for anyone but the admin", async () => {
  const { pageAdd } = mount({ me: meOf({ isAdmin: false }) });
  await screen.findByText("Only the admin can manage users.");
  expect(pageAdd()).toBeNull();
});

/* ---------- Add user ---------- */

const openAdd = async (user: ReturnType<typeof userEvent.setup>) => {
  await row(/Jordan Lee/);
  const buttons = screen.getAllByRole("button", { name: "Add user" });
  await user.click(buttons[0] as HTMLElement);
  return sheet();
};

it("opens the Add user sheet with a name, an email and a temporary password made in the browser", async () => {
  const user = userEvent.setup();
  mount();
  await openAdd(user);
  const name = within(sheet()).getByLabelText("Name");
  await waitFor(() => expect(name).toHaveFocus());
  expect(within(sheet()).getByLabelText("Email")).toHaveAttribute(
    "type",
    "email",
  );
  expect(passwordShown()).toMatch(/^[a-z]+-[a-z]+-\d{4}-[a-z]+$/);
  expect(
    within(sheet()).getByText("They start with their own empty ledger."),
  ).toBeInTheDocument();
  expect(
    within(sheet()).getByText("They choose their own at first sign-in."),
  ).toBeInTheDocument();
  expect(
    within(sheet()).getByRole("button", { name: /Make a new one/ }),
  ).toBeInTheDocument();
});

it("makes another password on 'Make a new one'", async () => {
  const user = userEvent.setup();
  mount();
  await openAdd(user);
  const first = passwordShown();
  await user.click(
    within(sheet()).getByRole("button", { name: /Make a new one/ }),
  );
  expect(passwordShown()).not.toBe(first);
});

it("copies the password shown and says so", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn(async () => undefined);
  mount();
  await openAdd(user);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  await user.click(within(sheet()).getByRole("button", { name: /Copy/ }));
  expect(writeText).toHaveBeenCalledWith(passwordShown());
  expect(await within(sheet()).findByText("Copied")).toBeInTheDocument();
  // A new password is not the copied one.
  await user.click(
    within(sheet()).getByRole("button", { name: /Make a new one/ }),
  );
  expect(within(sheet()).queryByText("Copied")).toBeNull();
});

it("says to select the password when copying is not allowed", async () => {
  const user = userEvent.setup();
  mount();
  await openAdd(user);
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
    configurable: true,
  });
  await user.click(within(sheet()).getByRole("button", { name: /Copy/ }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "Couldn't copy. Select the password and copy it yourself.",
  );
});

it("adds the person with the password that is shown, then closes, says so and lists them", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openAdd(user);
  const password = passwordShown();
  await user.type(within(sheet()).getByLabelText("Name"), "  Avery Stone ");
  await user.type(
    within(sheet()).getByLabelText("Email"),
    " avery@example.com ",
  );
  await user.click(within(sheet()).getByRole("button", { name: "Add user" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    {
      url: "/api/v1/users",
      method: "POST",
      body: {
        name: "Avery Stone",
        email: "avery@example.com",
        temporaryPassword: password,
      },
    },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Avery can sign in. They set their own password first.",
  );
  expect(await row(/Avery Stone/)).toHaveTextContent("Temporary password");
});

it("keeps the password nowhere once the sheet is closed: not on the page, not in the cache", async () => {
  const user = userEvent.setup();
  mount();
  await openAdd(user);
  const password = passwordShown();
  await user.type(within(sheet()).getByLabelText("Name"), "Avery Stone");
  await user.type(within(sheet()).getByLabelText("Email"), "avery@example.com");
  await user.click(within(sheet()).getByRole("button", { name: "Add user" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await row(/Avery Stone/);
  expect(document.body.textContent).not.toContain(password);
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain(password);
  // A new sheet makes a new password.
  await user.click(
    screen.getAllByRole("button", { name: "Add user" })[0] as HTMLElement,
  );
  expect(passwordShown()).not.toBe(password);
});

it("refuses an empty name or a bad email on its own row without asking the server", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openAdd(user);
  await user.click(within(sheet()).getByRole("button", { name: "Add user" }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "Enter their name.",
  );
  expect(within(sheet()).getByLabelText("Name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  // The focus is where the mistake is (here it already was: the sheet opens on Name).
  expect(within(sheet()).getByLabelText("Name")).toHaveFocus();
  await user.type(within(sheet()).getByLabelText("Name"), "Avery");
  await user.type(within(sheet()).getByLabelText("Email"), "avery");
  await user.click(within(sheet()).getByRole("button", { name: "Add user" }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "Enter a valid email address.",
  );
  expect(within(sheet()).getByLabelText("Email")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  // The button was pressed, so only the sheet itself can have moved the focus to the row with the mistake.
  await waitFor(() =>
    expect(within(sheet()).getByLabelText("Email")).toHaveFocus(),
  );
  expect(writes).toEqual([]);
});

it("says what a taken email means, on the email row, and keeps the sheet open", async () => {
  const user = userEvent.setup();
  mount({
    write: () =>
      problem(
        409,
        "That person was deleted. Restore them from Recently deleted (5 days left), or use another email.",
      ),
  });
  await openAdd(user);
  await user.type(within(sheet()).getByLabelText("Name"), "Jordan");
  await user.type(
    within(sheet()).getByLabelText("Email"),
    "jordan@example.com",
  );
  await user.click(within(sheet()).getByRole("button", { name: "Add user" }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "That person was deleted. Restore them from Recently deleted (5 days left), or use another email.",
  );
  expect(within(sheet()).getByLabelText("Email")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(sheet()).toBeInTheDocument();
});

it("never calls a lost answer a failure: says to check the list, and reads the list again", async () => {
  const user = userEvent.setup();
  const { reads } = mount({ write: () => json({}, 500) });
  await openAdd(user);
  await user.type(within(sheet()).getByLabelText("Name"), "Avery");
  await user.type(within(sheet()).getByLabelText("Email"), "avery@example.com");
  const before = reads.filter((read) => read.endsWith("/users")).length;
  await user.click(within(sheet()).getByRole("button", { name: "Add user" }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "We couldn't confirm that. Check the list, then try again.",
  );
  await waitFor(() =>
    expect(
      reads.filter((read) => read.endsWith("/users")).length,
    ).toBeGreaterThan(before),
  );
});

/* ---------- One sheet per person ---------- */

const openPerson = async (
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) => {
  await user.click(await row(name));
  return sheet();
};
const rowNames = () =>
  [...sheet().querySelectorAll(".ui-row-title")].map(
    (title) => title.textContent,
  );

it("opens a person's sheet with the actions that fit them, Delete last", async () => {
  const user = userEvent.setup();
  mount();
  await openPerson(user, /Jordan Lee/);
  expect(sheet()).toHaveAccessibleName("Jordan Lee");
  expect(rowNames()).toEqual([
    "Reset password",
    "Turn off two-factor",
    "Sign out their devices",
    "Stop sign-in",
    "Clear their ledger",
    "Delete user",
  ]);
  expect(
    within(sheet()).getByText("Their ledger stays as it is"),
  ).toBeInTheDocument();
});

it("leaves out 'Turn off two-factor' for a person who has none, and says a temporary password is still in place", async () => {
  const user = userEvent.setup();
  mount();
  await openPerson(user, /Riley Park/);
  expect(rowNames()).not.toContain("Turn off two-factor");
  expect(
    within(sheet()).getByRole("button", { name: /Reset password/ }),
  ).toHaveTextContent("Still on a temporary password");
});

it("says nothing under Reset password for a person who has chosen their own", async () => {
  const user = userEvent.setup();
  mount();
  await openPerson(user, /Jordan Lee/);
  expect(
    within(sheet()).getByRole("button", { name: /Reset password/ }),
  ).not.toHaveTextContent("temporary");
});

it("says 'Allow sign-in again' for a stopped person and allows it at once, with no question", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPerson(user, /Casey Ng/);
  expect(rowNames()).not.toContain("Stop sign-in");
  await user.click(
    within(sheet()).getByRole("button", { name: /Allow sign-in again/ }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    {
      url: expect.stringMatching(/\/api\/v1\/users\/.+/),
      method: "PATCH",
      body: { disabled: false },
    },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Casey can sign in again.",
  );
});

it("shows Clear their ledger and Delete user in the danger colour class and nothing else red", async () => {
  const user = userEvent.setup();
  mount();
  await openPerson(user, /Jordan Lee/);
  const red = [...sheet().querySelectorAll(".us-danger")].map(
    (el) => el.textContent,
  );
  expect(red).toEqual(["Clear their ledger", "Delete user"]);
});

it("resets the password: a new one is shown, sent for that person, and the sheet says so", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPerson(user, /Jordan Lee/);
  await user.click(
    within(sheet()).getByRole("button", { name: /Reset password/ }),
  );
  expect(sheet()).toHaveAccessibleName("New temporary password");
  const password = passwordShown();
  expect(password).toMatch(/^[a-z]+-[a-z]+-\d{4}-[a-z]+$/);
  expect(
    within(sheet()).getByText(
      "They are signed out and choose a new password at their next sign-in.",
    ),
  ).toBeInTheDocument();
  await user.click(
    within(sheet()).getByRole("button", { name: /Make a new one/ }),
  );
  const second = passwordShown();
  expect(second).not.toBe(password);
  await user.click(
    within(sheet()).getByRole("button", { name: "Reset password" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    {
      url: `/api/v1/users/${jordan.id}/password`,
      method: "POST",
      body: { temporaryPassword: second },
    },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Password reset for Jordan.",
  );
  expect(document.body.textContent).not.toContain(second);
});

it("turns off two-factor only after a question, then says so", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPerson(user, /Jordan Lee/);
  await user.click(
    within(sheet()).getByRole("button", { name: /Turn off two-factor/ }),
  );
  const question = screen.getAllByRole("dialog").at(-1) as HTMLElement;
  expect(question).toHaveAccessibleName("Turn off two-factor for Jordan?");
  expect(writes).toEqual([]);
  await user.click(within(question).getByRole("button", { name: "Turn off" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    {
      url: `/api/v1/users/${jordan.id}/two-factor`,
      method: "DELETE",
      body: {},
    },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Two-factor turned off.",
  );
});

it("signs a person's devices out after a question", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPerson(user, /Jordan Lee/);
  await user.click(
    within(sheet()).getByRole("button", { name: /Sign out their devices/ }),
  );
  const question = screen.getAllByRole("dialog").at(-1) as HTMLElement;
  expect(question).toHaveAccessibleName("Sign out Jordan's devices?");
  await user.click(within(question).getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    { url: `/api/v1/users/${jordan.id}/sessions`, method: "DELETE", body: {} },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Signed them out.",
  );
});

it("stops a sign-in after a question that says the ledger is not changed", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPerson(user, /Jordan Lee/);
  await user.click(
    within(sheet()).getByRole("button", { name: /Stop sign-in/ }),
  );
  const question = screen.getAllByRole("dialog").at(-1) as HTMLElement;
  expect(question).toHaveAccessibleName("Stop Jordan signing in?");
  expect(question).toHaveTextContent("Their ledger is not changed.");
  await user.click(
    within(question).getByRole("button", { name: "Stop sign-in" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    {
      url: `/api/v1/users/${jordan.id}`,
      method: "PATCH",
      body: { disabled: true },
    },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Jordan can no longer sign in.",
  );
});

it("writes nothing when a question is cancelled", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPerson(user, /Jordan Lee/);
  await user.click(
    within(sheet()).getByRole("button", { name: /Sign out their devices/ }),
  );
  const question = screen.getAllByRole("dialog").at(-1) as HTMLElement;
  await user.click(within(question).getByRole("button", { name: "Cancel" }));
  expect(writes).toEqual([]);
  expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1);
});

it("deletes only after their email is typed, in any letter case", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPerson(user, /Jordan Lee/);
  await user.click(
    within(sheet()).getByRole("button", { name: /Delete user/ }),
  );
  const question = screen.getAllByRole("dialog").at(-1) as HTMLElement;
  expect(question).toHaveAccessibleName("Delete Jordan and their ledger?");
  expect(question).toHaveTextContent(
    "They cannot sign in. You can restore them for 30 days, then everything is removed for good.",
  );
  const confirm = within(question).getByRole("button", { name: "Delete" });
  expect(confirm).toBeDisabled();
  const typed = within(question).getByLabelText("Type their email to confirm");
  expect(typed).toHaveAttribute("placeholder", "jordan@example.com");
  await user.type(typed, "jordan");
  expect(confirm).toBeDisabled();
  await user.clear(typed);
  await user.type(typed, "Jordan@Example.com");
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    { url: `/api/v1/users/${jordan.id}`, method: "DELETE", body: {} },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent("User deleted.");
});

it("does not delete on Enter in the email box while the email is wrong", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPerson(user, /Jordan Lee/);
  await user.click(
    within(sheet()).getByRole("button", { name: /Delete user/ }),
  );
  const question = screen.getAllByRole("dialog").at(-1) as HTMLElement;
  await user.type(
    within(question).getByLabelText("Type their email to confirm"),
    "nope{Enter}",
  );
  expect(writes).toEqual([]);
});

it("shows the server's refusal inside the question and keeps it open", async () => {
  const user = userEvent.setup();
  mount({ write: () => problem(409, "That account can't be changed here.") });
  await openPerson(user, /Jordan Lee/);
  await user.click(
    within(sheet()).getByRole("button", { name: /Sign out their devices/ }),
  );
  const question = screen.getAllByRole("dialog").at(-1) as HTMLElement;
  await user.click(within(question).getByRole("button", { name: "Sign out" }));
  expect(await within(question).findByRole("alert")).toHaveTextContent(
    "That account can't be changed here.",
  );
  expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2);
});

it("says a person is gone, and reads the list again, when the server cannot find them", async () => {
  const user = userEvent.setup();
  const { reads } = mount({ write: () => problem(404, "Not found.") });
  await openPerson(user, /Jordan Lee/);
  await user.click(
    within(sheet()).getByRole("button", { name: /Sign out their devices/ }),
  );
  const question = screen.getAllByRole("dialog").at(-1) as HTMLElement;
  const before = reads.filter((read) => read.endsWith("/users")).length;
  await user.click(within(question).getByRole("button", { name: "Sign out" }));
  expect(await within(question).findByRole("alert")).toHaveTextContent(
    "They are no longer on this server.",
  );
  await waitFor(() =>
    expect(
      reads.filter((read) => read.endsWith("/users")).length,
    ).toBeGreaterThan(before),
  );
});

it("a reset that cannot be confirmed says so and keeps the password on screen", async () => {
  const user = userEvent.setup();
  mount({ write: () => json({}, 500) });
  await openPerson(user, /Jordan Lee/);
  await user.click(
    within(sheet()).getByRole("button", { name: /Reset password/ }),
  );
  const password = passwordShown();
  await user.click(
    within(sheet()).getByRole("button", { name: "Reset password" }),
  );
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "We couldn't confirm that. Please try again.",
  );
  expect(passwordShown()).toBe(password);
});

it("empties the email box when a Delete question is cancelled and opened again", async () => {
  const user = userEvent.setup();
  mount();
  await openPerson(user, /Jordan Lee/);
  const ask = async () => {
    await user.click(
      within(sheet()).getByRole("button", { name: /Delete user/ }),
    );
    return screen.getAllByRole("dialog").at(-1) as HTMLElement;
  };
  let question = await ask();
  await user.type(
    within(question).getByLabelText("Type their email to confirm"),
    "jordan@example.com",
  );
  await user.click(within(question).getByRole("button", { name: "Cancel" }));
  question = await ask();
  expect(
    within(question).getByLabelText("Type their email to confirm"),
  ).toHaveValue("");
  expect(
    within(question).getByRole("button", { name: "Delete" }),
  ).toBeDisabled();
});

it("makes only Delete's confirming button red", async () => {
  const user = userEvent.setup();
  mount();
  await openPerson(user, /Jordan Lee/);
  const confirmOf = async (row: RegExp, confirm: string) => {
    await user.click(within(sheet()).getByRole("button", { name: row }));
    const question = screen.getAllByRole("dialog").at(-1) as HTMLElement;
    const button = within(question).getByRole("button", { name: confirm });
    const red = button.classList.contains("ui-btn-danger-filled");
    await user.click(within(question).getByRole("button", { name: "Cancel" }));
    return red;
  };
  expect(await confirmOf(/Delete user/, "Delete")).toBe(true);
  expect(await confirmOf(/Stop sign-in/, "Stop sign-in")).toBe(false);
  expect(await confirmOf(/Sign out their devices/, "Sign out")).toBe(false);
  expect(await confirmOf(/Turn off two-factor/, "Turn off")).toBe(false);
});

/* ---------- Clear and restore a person's ledger (ADR 0049) ---------- */

const clearedAt = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * DAY).toISOString();
const ledgerRows = () =>
  [...sheet().querySelectorAll(".ui-card")].map((card) =>
    [...card.querySelectorAll(".ui-row-title")].map((t) => t.textContent),
  );
const ask = async (
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
): Promise<HTMLElement> => {
  await user.click(within(sheet()).getByRole("button", { name }));
  return screen.getAllByRole("dialog").at(-1) as HTMLElement;
};

it("offers 'Clear their ledger' with its one short hint, and no restore while nothing waits", async () => {
  const user = userEvent.setup();
  mount();
  await openPerson(user, /Jordan Lee/);
  expect(ledgerRows()[1]).toEqual(["Clear their ledger"]);
  expect(within(sheet()).getByText("Undo for 30 days")).toBeInTheDocument();
  expect(within(sheet()).queryByText(/Restore cleared ledger/)).toBeNull();
});

it("reads an answer without ledgerClearedAt, or with null, as nothing to restore", async () => {
  const user = userEvent.setup();
  mount({ people: [sam, jordan] });
  await openPerson(user, /Jordan Lee/);
  expect(within(sheet()).queryByText(/Restore cleared ledger/)).toBeNull();
  await user.keyboard("{Escape}");
  cleanup();
  client.clear();
  mount({ people: [sam, { ...jordan, ledgerClearedAt: null }] });
  await openPerson(user, /Jordan Lee/);
  expect(within(sheet()).queryByText(/Restore cleared ledger/)).toBeNull();
});

it("puts 'Restore cleared ledger' with its days left above 'Clear their ledger' while an undo waits", async () => {
  const user = userEvent.setup();
  // Cleared 12.5 days ago: 17.5 days of the 30 are left, which reads as 18.
  mount({ people: [sam, { ...jordan, ledgerClearedAt: clearedAt(12.5) }] });
  await openPerson(user, /Jordan Lee/);
  expect(ledgerRows()[1]).toEqual([
    "Restore cleared ledger",
    "Clear their ledger",
  ]);
  expect(within(sheet()).getByText("18 days left")).toBeInTheDocument();
});

it("says '1 day left' on the last day of an undo", async () => {
  const user = userEvent.setup();
  mount({ people: [sam, { ...jordan, ledgerClearedAt: clearedAt(29.9) }] });
  await openPerson(user, /Jordan Lee/);
  expect(within(sheet()).getByText("1 day left")).toBeInTheDocument();
});

it("clears a ledger only after the person's email is typed, then says so and reads the list again", async () => {
  const user = userEvent.setup();
  const { writes, reads } = mount();
  await openPerson(user, /Jordan Lee/);
  const question = await ask(user, /Clear their ledger/);
  expect(question).toHaveAccessibleName("Clear Jordan's ledger?");
  expect(question).toHaveTextContent(
    "Their accounts, entries and budgets leave the app so they can start fresh. You can undo this for 30 days.",
  );
  const confirm = within(question).getByRole("button", { name: "Clear" });
  expect(confirm).toHaveClass("ui-btn-danger-filled");
  expect(confirm).toBeDisabled();
  const typed = within(question).getByLabelText("Type their email to confirm");
  expect(typed).toHaveAttribute("placeholder", "jordan@example.com");
  await user.type(typed, "jordan");
  expect(confirm).toBeDisabled();
  await user.clear(typed);
  await user.type(typed, " Jordan@Example.com ");
  expect(confirm).toBeEnabled();
  const before = reads.filter((read) => read.endsWith("/users")).length;
  await user.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    {
      url: `/api/v1/users/${jordan.id}/ledger/clear`,
      method: "POST",
      body: {},
    },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Ledger cleared.",
  );
  await waitFor(() =>
    expect(
      reads.filter((read) => read.endsWith("/users")).length,
    ).toBeGreaterThan(before),
  );
});

it("does not clear on Enter in the email box while the email is wrong", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPerson(user, /Jordan Lee/);
  const question = await ask(user, /Clear their ledger/);
  await user.type(
    within(question).getByLabelText("Type their email to confirm"),
    "jord{Enter}",
  );
  expect(writes).toEqual([]);
});

it("writes nothing and empties the email box when the Clear question is cancelled and opened again", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPerson(user, /Jordan Lee/);
  let question = await ask(user, /Clear their ledger/);
  await user.type(
    within(question).getByLabelText("Type their email to confirm"),
    "jordan@example.com",
  );
  await user.click(within(question).getByRole("button", { name: "Cancel" }));
  question = await ask(user, /Clear their ledger/);
  expect(
    within(question).getByLabelText("Type their email to confirm"),
  ).toHaveValue("");
  expect(writes).toEqual([]);
});

it("restores a cleared ledger after a question, in the calm button colour, then says so", async () => {
  const user = userEvent.setup();
  const { writes } = mount({
    people: [sam, { ...jordan, ledgerClearedAt: clearedAt(5) }],
  });
  await openPerson(user, /Jordan Lee/);
  const question = await ask(user, /Restore cleared ledger/);
  expect(question).toHaveAccessibleName("Restore Jordan's ledger?");
  expect(question).toHaveTextContent(
    "Everything comes back as it was. This works only while their ledger is empty.",
  );
  expect(within(question).queryByLabelText(/Type/)).toBeNull();
  const confirm = within(question).getByRole("button", { name: "Restore" });
  expect(confirm).not.toHaveClass("ui-btn-danger-filled");
  await user.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    {
      url: `/api/v1/users/${jordan.id}/ledger/restore`,
      method: "POST",
      body: {},
    },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Ledger restored.",
  );
});

it("shows the server's refusal to restore inside the question and keeps it open", async () => {
  const user = userEvent.setup();
  mount({
    people: [sam, { ...jordan, ledgerClearedAt: clearedAt(5) }],
    write: () => problem(409, "Clear what is there now first."),
  });
  await openPerson(user, /Jordan Lee/);
  const question = await ask(user, /Restore cleared ledger/);
  await user.click(within(question).getByRole("button", { name: "Restore" }));
  expect(await within(question).findByRole("alert")).toHaveTextContent(
    "Clear what is there now first.",
  );
  expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2);
});

it("never says a clear failed when the answer was lost", async () => {
  const user = userEvent.setup();
  mount({ write: () => problem(500, "boom") });
  await openPerson(user, /Jordan Lee/);
  const question = await ask(user, /Clear their ledger/);
  await user.type(
    within(question).getByLabelText("Type their email to confirm"),
    "jordan@example.com",
  );
  await user.click(within(question).getByRole("button", { name: "Clear" }));
  expect(await within(question).findByRole("alert")).toHaveTextContent(
    "We couldn't confirm that. Please try again.",
  );
});

/* ---------- Recently deleted (ADR 0049) ---------- */

const fold = () =>
  document.querySelector("details.ui-fold") as HTMLDetailsElement | null;
const foldRows = () =>
  [...(fold()?.querySelectorAll(".ui-row") ?? [])] as HTMLElement[];

it("shows no fold when nobody is waiting", async () => {
  mount();
  await row(/Jordan Lee/);
  expect(fold()).toBeNull();
  expect(screen.queryByText(/recently deleted/)).toBeNull();
});

it("shows 'N recently deleted' as a shut fold below the people", async () => {
  mount({ deleted: [taylor, morgan] });
  expect(await screen.findByText("2 recently deleted")).toBeInTheDocument();
  expect(fold()?.open).toBe(false);
  const user = userEvent.setup();
  await user.click(screen.getByText("2 recently deleted"));
  expect(fold()?.open).toBe(true);
});

it("lists each waiting person as a name, an email and one pill of days left, in the order sent", async () => {
  const user = userEvent.setup();
  mount({ deleted: [taylor, morgan, gone("Lee Fox", "lee@example.com", 1)] });
  await user.click(await screen.findByText("3 recently deleted"));
  expect(
    foldRows().map((r) => r.querySelector(".ui-row-title")?.textContent),
  ).toEqual(["Taylor Brooks", "Morgan Diaz", "Lee Fox"]);
  const [first, second, third] = foldRows() as [
    HTMLElement,
    HTMLElement,
    HTMLElement,
  ];
  expect(first).toHaveTextContent("taylor@example.com");
  expect(first.querySelector(".ui-row-hint")?.textContent).toBe(
    "taylor@example.com",
  );
  expect(first.querySelector(".ui-pill")).toHaveTextContent("23 days left");
  expect(second.querySelector(".ui-pill")).toHaveTextContent("3 days left");
  expect(third.querySelector(".ui-pill")).toHaveTextContent("1 day left");
});

it("turns the pill amber at 3 days or fewer and leaves it calm at 4", async () => {
  const user = userEvent.setup();
  mount({
    deleted: [
      gone("Four Days", "four@example.com", 3.5),
      gone("Three Days", "three@example.com", 3),
    ],
  });
  await user.click(await screen.findByText("2 recently deleted"));
  const [four, three] = foldRows().map((r) => r.querySelector(".ui-pill"));
  expect(four).toHaveTextContent("4 days left");
  expect(four).toHaveClass("ui-pill-neutral");
  expect(three).toHaveTextContent("3 days left");
  expect(three).toHaveClass("ui-pill-warning");
});

it("never asks for the deleted list when the person is not the admin", async () => {
  const { reads } = mount({ me: meOf({ isAdmin: false }) });
  await screen.findByText("Only the admin can manage users.");
  expect(reads.some((read) => read.endsWith("/users/deleted"))).toBe(false);
});

it("offers to try again when the deleted list cannot be read, and keeps the people shown", async () => {
  mount({ deletedFails: true });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't load recently deleted people.",
  );
  expect(await row(/Jordan Lee/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

const openDeleted = async (
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) => {
  await user.click(await screen.findByText(/recently deleted/));
  await user.click(await screen.findByRole("button", { name }));
  return sheet();
};

it("opens a deleted person's sheet with Restore and the days to restore, then Delete now in red", async () => {
  const user = userEvent.setup();
  mount({ deleted: [taylor, morgan] });
  await openDeleted(user, /Taylor Brooks/);
  expect(sheet()).toHaveAccessibleName("Taylor Brooks");
  expect(rowNames()).toEqual(["Restore", "Delete now"]);
  expect(
    within(sheet()).getByText("23 days left to restore"),
  ).toBeInTheDocument();
  expect(
    [...sheet().querySelectorAll(".us-danger")].map((el) => el.textContent),
  ).toEqual(["Delete now"]);
});

it("restores a deleted person with no question, then says so and reads both lists again", async () => {
  const user = userEvent.setup();
  const { writes, reads } = mount({ deleted: [taylor, morgan] });
  await openDeleted(user, /Taylor Brooks/);
  const people = reads.filter((read) => read.endsWith("/users")).length;
  const deleted = reads.filter((read) =>
    read.endsWith("/users/deleted"),
  ).length;
  await user.click(within(sheet()).getByRole("button", { name: /Restore/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    { url: `/api/v1/users/${taylor.id}/restore`, method: "POST", body: {} },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Taylor is back, as they were.",
  );
  await waitFor(() => {
    expect(
      reads.filter((read) => read.endsWith("/users")).length,
    ).toBeGreaterThan(people);
    expect(
      reads.filter((read) => read.endsWith("/users/deleted")).length,
    ).toBeGreaterThan(deleted);
  });
});

it("deletes a waiting person for good only after their email is typed, naming the backups", async () => {
  const user = userEvent.setup();
  const { writes } = mount({ deleted: [taylor] });
  await openDeleted(user, /Taylor Brooks/);
  const question = await ask(user, /Delete now/);
  expect(question).toHaveAccessibleName("Delete Taylor now?");
  expect(question).toHaveTextContent(
    "They and everything of theirs are removed for good, and the email can be used again.",
  );
  expect(question).toHaveTextContent("7 days on the server");
  expect(question).toHaveTextContent("90 days off-site");
  const confirm = within(question).getByRole("button", { name: "Delete now" });
  expect(confirm).toHaveClass("ui-btn-danger-filled");
  expect(confirm).toBeDisabled();
  const typed = within(question).getByLabelText("Type their email to confirm");
  expect(typed).toHaveAttribute("placeholder", "taylor@example.com");
  await user.type(typed, "taylor");
  expect(confirm).toBeDisabled();
  await user.clear(typed);
  await user.type(typed, "TAYLOR@example.com");
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    { url: `/api/v1/users/${taylor.id}/purge`, method: "DELETE", body: {} },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Deleted for good.",
  );
});

it("does not delete now on Enter while the email is wrong, and writes nothing when cancelled", async () => {
  const user = userEvent.setup();
  const { writes } = mount({ deleted: [taylor] });
  await openDeleted(user, /Taylor Brooks/);
  const question = await ask(user, /Delete now/);
  await user.type(
    within(question).getByLabelText("Type their email to confirm"),
    "tay{Enter}",
  );
  await user.click(within(question).getByRole("button", { name: "Cancel" }));
  expect(writes).toEqual([]);
});

it("says a waiting person is gone, and reads the lists again, when the server cannot find them", async () => {
  const user = userEvent.setup();
  const { reads } = mount({
    deleted: [taylor],
    write: () => problem(404, "Not found."),
  });
  await openDeleted(user, /Taylor Brooks/);
  const before = reads.filter((read) => read.endsWith("/users/deleted")).length;
  await user.click(within(sheet()).getByRole("button", { name: /Restore/ }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "They are no longer in Recently deleted.",
  );
  await waitFor(() =>
    expect(
      reads.filter((read) => read.endsWith("/users/deleted")).length,
    ).toBeGreaterThan(before),
  );
});

it("shows the server's refusal to restore on the sheet and never says a lost answer failed", async () => {
  const user = userEvent.setup();
  mount({
    deleted: [taylor],
    write: () => problem(409, "Someone else now has that email."),
  });
  await openDeleted(user, /Taylor Brooks/);
  await user.click(within(sheet()).getByRole("button", { name: /Restore/ }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "Someone else now has that email.",
  );
});

it("says a restore that cannot be confirmed could not be confirmed", async () => {
  const user = userEvent.setup();
  mount({ deleted: [taylor], write: () => problem(500, "boom") });
  await openDeleted(user, /Taylor Brooks/);
  await user.click(within(sheet()).getByRole("button", { name: /Restore/ }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "We couldn't confirm that. Please try again.",
  );
});

it("shows a refusal of Delete now once, inside the question, and not also on the sheet behind it", async () => {
  const user = userEvent.setup();
  mount({
    deleted: [taylor],
    write: () => problem(409, "Something still points at them."),
  });
  await openDeleted(user, /Taylor Brooks/);
  const ask_ = await ask(user, /Delete now/);
  await user.type(
    within(ask_).getByLabelText("Type their email to confirm"),
    "taylor@example.com",
  );
  await user.click(within(ask_).getByRole("button", { name: "Delete now" }));
  await within(ask_).findByRole("alert");
  expect(screen.getAllByRole("alert", { hidden: true })).toHaveLength(1);
});

it("empties the email box when the Delete now question is cancelled and opened again", async () => {
  const user = userEvent.setup();
  mount({ deleted: [taylor] });
  await openDeleted(user, /Taylor Brooks/);
  let question_ = await ask(user, /Delete now/);
  await user.type(
    within(question_).getByLabelText("Type their email to confirm"),
    "taylor@example.com",
  );
  await user.click(within(question_).getByRole("button", { name: "Cancel" }));
  question_ = await ask(user, /Delete now/);
  expect(
    within(question_).getByLabelText("Type their email to confirm"),
  ).toHaveValue("");
});
