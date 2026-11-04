import { newId } from "@ledgerline/shared";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { json } from "../../test-support/category-fixtures";
import { getMe, meKey } from "../profile/api";
import { PasswordGate } from "./password-gate";

const navigate = vi.fn(async () => undefined);
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

const required = "urn:ledgerline:problem:password-change-required";
const me = (over: Record<string, unknown> = {}) => ({
  id: newId(),
  name: "Riley Park",
  email: "riley@example.com",
  isAdmin: false,
  mustChangePassword: false,
  twoFactorEnabled: false,
  ...over,
});
let client: QueryClient;
beforeEach(() => navigate.mockClear());
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});

function mount({
  person = me() as Record<string, unknown> | null,
  other = (_path: string): Response | undefined => undefined,
} = {}) {
  const calls: { url: string; method: string }[] = [];
  const state = { person };
  const onSignOut = vi.fn(async () => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const path = String(url);
      calls.push({ url: path, method: init?.method ?? "GET" });
      if (path.endsWith("/me/password")) {
        state.person = { ...state.person, mustChangePassword: false };
        return new Response(null, { status: 204 });
      }
      if (path.endsWith("/me"))
        return state.person ? json(state.person) : json({}, 500);
      return other(path) ?? json({});
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PasswordGate onSignOut={onSignOut}>
        <p>The app</p>
      </PasswordGate>
    </QueryClientProvider>,
  );
  return { calls, onSignOut };
}

it("shows the app to a person who has their own password, once /me has answered", async () => {
  mount();
  expect(screen.queryByText("The app")).toBeNull();
  expect(await screen.findByText("The app")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Choose a new password" }),
  ).toBeNull();
});

it("shows the card, and nothing of the app, to a person on a temporary password", async () => {
  mount({ person: me({ mustChangePassword: true }) });
  expect(
    await screen.findByRole("heading", { name: "Choose a new password" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("The app")).toBeNull();
});

it("lets the app open when /me cannot be read: the server still refuses what it must", async () => {
  mount({ person: null });
  expect(await screen.findByText("The app")).toBeInTheDocument();
});

it("switches to the card when any request is refused for a required password change", async () => {
  mount();
  await screen.findByText("The app");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      json(
        { type: required, title: "Forbidden", status: 403, detail: "No." },
        403,
      ),
    ),
  );
  await api("/accounts").catch(() => undefined);
  expect(
    await screen.findByRole("heading", { name: "Choose a new password" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("The app")).toBeNull();
});

it("does not switch for any other 403", async () => {
  mount();
  await screen.findByText("The app");
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      json(
        { type: "about:blank", title: "Forbidden", status: 403, detail: "No." },
        403,
      ),
    ),
  );
  await api("/users").catch(() => undefined);
  expect(screen.getByText("The app")).toBeInTheDocument();
});

it("after the new password is saved, goes Home and shows the app", async () => {
  const user = userEvent.setup();
  mount({ person: me({ mustChangePassword: true }) });
  await user.type(
    await screen.findByLabelText("Temporary password"),
    "maple-otter-1234-river",
  );
  await user.type(
    screen.getByLabelText("New password"),
    "a brand new password",
  );
  await user.type(screen.getByLabelText("Confirm New"), "a brand new password");
  await user.click(screen.getByRole("button", { name: "Save and continue" }));
  expect(await screen.findByText("The app")).toBeInTheDocument();
  expect(navigate).toHaveBeenCalledWith({ to: "/" });
  expect(
    screen.queryByRole("heading", { name: "Choose a new password" }),
  ).toBeNull();
});

it("signs out from the card through the app's own sign-out", async () => {
  const user = userEvent.setup();
  const { onSignOut } = mount({ person: me({ mustChangePassword: true }) });
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
});

it("stops listening when it goes away: a later refusal changes nothing", async () => {
  mount();
  await screen.findByText("The app");
  cleanup();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      json(
        { type: required, title: "Forbidden", status: 403, detail: "No." },
        403,
      ),
    ),
  );
  await expect(api("/accounts")).rejects.toBeDefined();
  expect(client.getQueryData(["me"])).toMatchObject({
    mustChangePassword: false,
  });
});

it("opens the app once when /me cannot be read, and keeps it open while /me is asked again", async () => {
  // A failed query that is asked again goes back to "pending"; the app must not be swapped for the loading text each
  // time, or it would be mounted again, ask again, and so on without end.
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () => json({}, 500)),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let mounts = 0;
  function App() {
    const me = useQuery({ queryKey: meKey, queryFn: getMe });
    useEffect(() => {
      mounts += 1;
    }, []);
    return (
      <button type="button" onClick={() => void me.refetch()}>
        Ask again
      </button>
    );
  }
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <PasswordGate onSignOut={async () => undefined}>
        <App />
      </PasswordGate>
    </QueryClientProvider>,
  );
  const ask = await screen.findByRole("button", { name: "Ask again" });
  await user.click(ask);
  await user.click(ask);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.getByRole("button", { name: "Ask again" })).toBe(ask);
  expect(screen.queryByRole("status")).toBeNull();
  expect(mounts).toBe(1);
});
