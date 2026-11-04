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
import { ProfilePage } from "./profile-page";

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

const me = (over: Record<string, unknown> = {}) => ({
  id: newId(),
  name: "Sam Lee",
  email: "sam@example.com",
  isAdmin: true,
  mustChangePassword: false,
  twoFactorEnabled: true,
  ...over,
});
const device = (current = false) => ({
  id: newId(),
  current,
  device: "Chrome on macOS",
  createdAt: "2026-11-01T10:00:00.000Z",
  lastUsedAt: "2026-11-02T10:00:00.000Z",
  expiresAt: "2026-12-01T10:00:00.000Z",
});
type Write = { url: string; method: string; body: unknown };
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});

function mount({
  person = me(),
  devices = 2,
  failMe = false,
  write = (_write: Write): Response | undefined => undefined,
} = {}) {
  const writes: Write[] = [];
  const current = { person };
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
        if (path.endsWith("/me")) {
          current.person = { ...current.person, name: entry.body.name };
          return json(current.person);
        }
        return new Response(null, { status: 204 });
      }
      if (path.endsWith("/me"))
        return failMe ? json({}, 500) : json(current.person);
      if (path.endsWith("/sessions"))
        return json({
          items: Array.from({ length: devices }, (_, n) => device(n === 0)),
        });
      return json({});
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>,
  );
  return { writes };
}
const sheet = () => screen.getByRole("dialog");

it("shows the account, the password and the security rows, each in its own labelled group", async () => {
  mount();
  const account = await screen.findByRole("button", { name: /Sam Lee/ });
  expect(account).toHaveTextContent("sam@example.com");
  expect(account).toHaveTextContent("Admin");
  const groups = screen
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent);
  expect(groups).toEqual(["Account", "Password", "Security"]);
  expect(
    screen.getByRole("button", { name: /Change password/ }),
  ).toHaveTextContent("12 characters or more");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Profile",
  );
});

it("shows no Admin pill for anyone but the admin", async () => {
  mount({ person: me({ isAdmin: false }) });
  const account = await screen.findByRole("button", { name: /Sam Lee/ });
  expect(account).not.toHaveTextContent("Admin");
});

it("says whether two-factor is on and how many devices are signed in, both leading to Settings", async () => {
  mount({ devices: 3 });
  const twoFactor = await screen.findByRole("link", { name: /Two-factor/ });
  expect(twoFactor).toHaveAttribute("href", "/settings");
  expect(twoFactor).toHaveTextContent("On");
  const devices = await screen.findByRole("link", {
    name: /Signed-in devices/,
  });
  expect(devices).toHaveAttribute("href", "/settings");
  await waitFor(() => expect(devices).toHaveTextContent("3"));
});

it("says Off when two-factor is off", async () => {
  mount({ person: me({ twoFactorEnabled: false }) });
  expect(
    await screen.findByRole("link", { name: /Two-factor/ }),
  ).toHaveTextContent("Off");
});

it("has no subtitle, and no row says more than a title and one short hint", async () => {
  mount();
  await screen.findByRole("button", { name: /Sam Lee/ });
  for (const hint of document.querySelectorAll(".ui-row-hint"))
    expect((hint.textContent ?? "").length).toBeLessThan(40);
  expect(document.querySelector(".page-heading p")).toBeNull();
});

it("offers to try again when the profile cannot be read", async () => {
  mount({ failMe: true });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn't load your profile.",
  );
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Change password/ })).toBeNull();
});

it("changes the name: the sheet opens on the field, saves the trimmed name and says so", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await user.click(await screen.findByRole("button", { name: /Sam Lee/ }));
  const field = within(sheet()).getByLabelText("Name");
  await waitFor(() => expect(field).toHaveFocus());
  expect(field).toHaveValue("Sam Lee");
  expect(within(sheet()).queryByLabelText(/email/i)).toBeNull();
  await user.clear(field);
  await user.type(field, "  Sam Park  ");
  await user.click(within(sheet()).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    { url: "/api/v1/me", method: "PATCH", body: { name: "Sam Park" } },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent("Name saved.");
  expect(
    await screen.findByRole("button", { name: /Sam Park/ }),
  ).toBeInTheDocument();
});

it("refuses an empty or too long name without asking the server", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await user.click(await screen.findByRole("button", { name: /Sam Lee/ }));
  const field = within(sheet()).getByLabelText("Name");
  await user.clear(field);
  await user.click(within(sheet()).getByRole("button", { name: "Save" }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "Use 1 to 100 characters.",
  );
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(writes).toEqual([]);
  // Typing again clears the message.
  await user.type(field, "S");
  expect(within(sheet()).queryByRole("alert")).toBeNull();
});

it("keeps the name sheet open and says why when the server refuses", async () => {
  const user = userEvent.setup();
  mount({
    write: () =>
      json(
        {
          type: "about:blank",
          title: "x",
          status: 400,
          detail: "Check the request fields.",
          errors: [],
        },
        400,
      ),
  });
  await user.click(await screen.findByRole("button", { name: /Sam Lee/ }));
  await user.click(within(sheet()).getByRole("button", { name: "Save" }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "Check the request fields.",
  );
  expect(sheet()).toBeInTheDocument();
});

it("asks to try again when a name's answer is lost, never saying it failed", async () => {
  const user = userEvent.setup();
  mount({ write: () => json({}, 500) });
  await user.click(await screen.findByRole("button", { name: /Sam Lee/ }));
  await user.click(within(sheet()).getByRole("button", { name: "Save" }));
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "We couldn't save that. Please try again.",
  );
});

const fill = async (
  user: ReturnType<typeof userEvent.setup>,
  current: string,
  next: string,
  repeat: string,
) => {
  await user.type(within(sheet()).getByLabelText("Current"), current);
  await user.type(within(sheet()).getByLabelText("New"), next);
  await user.type(within(sheet()).getByLabelText("Repeat it"), repeat);
};
const openPassword = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole("button", { name: /Change password/ }));

it("changes the password: three password fields, the switch on, the request and a notice", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPassword(user);
  const current = within(sheet()).getByLabelText("Current");
  await waitFor(() => expect(current).toHaveFocus());
  expect(current).toHaveAttribute("type", "password");
  expect(current).toHaveAttribute("autocomplete", "current-password");
  for (const label of ["New", "Repeat it"]) {
    expect(within(sheet()).getByLabelText(label)).toHaveAttribute(
      "type",
      "password",
    );
    expect(within(sheet()).getByLabelText(label)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  }
  const others = within(sheet()).getByRole("switch", {
    name: "Sign out my other devices",
  });
  expect(others).toBeChecked();
  await fill(user, "old-password-1", "a-new-password-2", "a-new-password-2");
  await user.click(
    within(sheet()).getByRole("button", { name: "Save password" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(writes).toEqual([
    {
      url: "/api/v1/me/password",
      method: "POST",
      body: {
        currentPassword: "old-password-1",
        newPassword: "a-new-password-2",
        signOutOtherDevices: true,
      },
    },
  ]);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Password changed.",
  );
});

it("keeps this device's neighbours signed in when the switch is turned off", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPassword(user);
  await user.click(
    within(sheet()).getByRole("switch", { name: "Sign out my other devices" }),
  );
  expect(
    within(sheet()).getByRole("switch", { name: "Sign out my other devices" }),
  ).not.toBeChecked();
  await fill(user, "old-password-1", "a-new-password-2", "a-new-password-2");
  await user.click(
    within(sheet()).getByRole("button", { name: "Save password" }),
  );
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.body).toMatchObject({ signOutOtherDevices: false });
});

it("checks what it can before asking the server, one row at a time, and focuses that row", async () => {
  const user = userEvent.setup();
  const { writes } = mount();
  await openPassword(user);
  await user.click(
    within(sheet()).getByRole("button", { name: "Save password" }),
  );
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "Enter your current password.",
  );
  expect(within(sheet()).getByLabelText("Current")).toHaveFocus();
  await fill(user, "old-password-1", "short", "short");
  await user.click(
    within(sheet()).getByRole("button", { name: "Save password" }),
  );
  expect(within(sheet()).getByRole("alert")).toHaveTextContent(
    "Use 12 characters or more.",
  );
  expect(within(sheet()).getByLabelText("New")).toHaveFocus();
  expect(within(sheet()).getByLabelText("New")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await user.clear(within(sheet()).getByLabelText("New"));
  await user.type(within(sheet()).getByLabelText("New"), "a-new-password-2");
  await user.click(
    within(sheet()).getByRole("button", { name: "Save password" }),
  );
  expect(within(sheet()).getByRole("alert")).toHaveTextContent(
    "The two new passwords are different.",
  );
  expect(within(sheet()).getByLabelText("Repeat it")).toHaveFocus();
  expect(writes).toEqual([]);
});

it("shows the server's answer on the row it names: a wrong current password, and a password in use", async () => {
  const user = userEvent.setup();
  let answer = {
    field: "currentPassword",
    message: "That is not your current password.",
  };
  mount({
    write: () =>
      json(
        {
          type: "about:blank",
          title: "x",
          status: 400,
          detail: "Check the request fields.",
          errors: [answer],
        },
        400,
      ),
  });
  await openPassword(user);
  await fill(user, "wrong-password-1", "a-new-password-2", "a-new-password-2");
  await user.click(
    within(sheet()).getByRole("button", { name: "Save password" }),
  );
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "That is not your current password.",
  );
  expect(within(sheet()).getByLabelText("Current")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await waitFor(() =>
    expect(within(sheet()).getByLabelText("Current")).toHaveFocus(),
  );
  expect(sheet()).toBeInTheDocument();
  answer = {
    field: "newPassword",
    message: "Choose a password you do not use now.",
  };
  await user.type(within(sheet()).getByLabelText("Current"), "!");
  await user.click(
    within(sheet()).getByRole("button", { name: "Save password" }),
  );
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "Choose a password you do not use now.",
  );
  await waitFor(() =>
    expect(within(sheet()).getByLabelText("New")).toHaveFocus(),
  );
});

it("says to wait when too many wrong passwords were tried", async () => {
  const user = userEvent.setup();
  mount({
    write: () =>
      json(
        {
          type: "about:blank",
          title: "Too many attempts",
          status: 429,
          detail: "Too many attempts. Wait a few minutes and try again.",
          errors: [],
        },
        429,
      ),
  });
  await openPassword(user);
  await fill(user, "old-password-1", "a-new-password-2", "a-new-password-2");
  await user.click(
    within(sheet()).getByRole("button", { name: "Save password" }),
  );
  expect(await within(sheet()).findByRole("alert")).toHaveTextContent(
    "Too many attempts",
  );
});

it("holds the fields and the button while it saves", async () => {
  const user = userEvent.setup();
  let release: (value: Response) => void = () => {};
  mount({
    write: () => undefined,
  });
  // Replace the answer with one that waits.
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) =>
      init?.method === "POST" ? pending : original(url, init),
    ),
  );
  await openPassword(user);
  await fill(user, "old-password-1", "a-new-password-2", "a-new-password-2");
  await user.click(
    within(sheet()).getByRole("button", { name: "Save password" }),
  );
  const saving = await within(sheet()).findByRole("button", {
    name: "Saving…",
  });
  expect(saving).toBeDisabled();
  expect(within(sheet()).getByLabelText("Current")).toBeDisabled();
  release(new Response(null, { status: 204 }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("forgets what was typed: a new sheet opens empty", async () => {
  const user = userEvent.setup();
  mount();
  await openPassword(user);
  await user.type(within(sheet()).getByLabelText("Current"), "old-password-1");
  await user.click(within(sheet()).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await openPassword(user);
  expect(within(sheet()).getByLabelText("Current")).toHaveValue("");
});

it("tells the session about a new name, so the sidebar follows", async () => {
  const user = userEvent.setup();
  mount();
  const spy = vi.spyOn(client, "invalidateQueries");
  await user.click(await screen.findByRole("button", { name: /Sam Lee/ }));
  await user.click(within(sheet()).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(spy).toHaveBeenCalledWith({ queryKey: ["session"] });
});

it("reads the devices again after the password changed, since other devices may have been signed out", async () => {
  const user = userEvent.setup();
  mount();
  const asked = () =>
    vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith("/sessions")).length;
  await waitFor(() => expect(asked()).toBe(1));
  await openPassword(user);
  await fill(user, "old-password-1", "a-new-password-2", "a-new-password-2");
  await user.click(
    within(sheet()).getByRole("button", { name: "Save password" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(asked()).toBe(2));
});
