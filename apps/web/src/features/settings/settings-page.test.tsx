import { newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmountEntryContext,
  PrivacyControlContext,
  SignOutContext,
  ThemeContext,
} from "../../lib/preferences";
import { SettingsPage } from "./settings-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const ledgerId = newId();
const ledger = (timeZone: string, version: number) => ({
  id: ledgerId,
  name: "Personal",
  baseCurrency: "USD",
  timeZone,
  version,
  role: "owner",
});
function stubServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace("/api/v1", "");
      if (init?.method === "PATCH")
        return new Response(JSON.stringify(ledger("America/Chicago", 5)));
      if (path === "/ledgers")
        return new Response(JSON.stringify({ items: [ledger("UTC", 4)] }));
      if (path === "/auth/get-session")
        return new Response(
          JSON.stringify({
            user: {
              id: "u",
              name: "You",
              email: "you@example.com",
              twoFactorEnabled: true,
            },
          }),
        );
      if (path === "/sessions")
        return new Response(JSON.stringify({ items: [] }));
      return new Response(JSON.stringify({ items: [] }));
    }),
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(
  props: {
    theme?: "light" | "dark" | "system";
    privateMode?: boolean;
    centsFirst?: boolean;
  } = {},
) {
  stubServer();
  const setTheme = vi.fn();
  const setPrivateMode = vi.fn();
  const setCentsFirst = vi.fn();
  const signOut = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SignOutContext value={signOut}>
        <ThemeContext value={{ theme: props.theme ?? "system", setTheme }}>
          <PrivacyControlContext
            value={{
              privateMode: props.privateMode ?? false,
              setPrivateMode,
            }}
          >
            <AmountEntryContext
              value={{ centsFirst: props.centsFirst ?? false, setCentsFirst }}
            >
              <SettingsPage />
            </AmountEntryContext>
          </PrivacyControlContext>
        </ThemeContext>
      </SignOutContext>
    </QueryClientProvider>,
  );
  return { setTheme, setPrivateMode, setCentsFirst, signOut };
}
const group = (name: string) =>
  screen.getByRole("region", { name }) as HTMLElement;

describe("SettingsPage", () => {
  it("puts appearance, privacy, the ledger and the data in the left column and security, devices and Sign out in the right", async () => {
    mount();
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeTruthy();
    const columns = document.querySelectorAll(".set-cols > .set-stack");
    expect(columns).toHaveLength(2);
    const names = (column: Element | undefined) =>
      [...(column?.querySelectorAll(":scope > section") ?? [])].map(
        (section) => section.querySelector("h2")?.textContent,
      );
    expect(names(columns[0])).toEqual([
      "Appearance",
      "Privacy and input",
      "Ledger",
      "Your data",
    ]);
    expect(names(columns[1])).toEqual(["Security", "Signed-in devices"]);
    expect(
      within(columns[1] as HTMLElement).getByRole("button", {
        name: "Sign out",
      }),
    ).toBeTruthy();
    await screen.findByText("Two-factor");
  });

  it("draws none of the old page: no eyebrow, subtitle, scope labels or cards", async () => {
    mount();
    expect(screen.queryByText("MAKE IT YOURS")).toBeNull();
    expect(screen.queryByText(/little details/)).toBeNull();
    expect(screen.queryByText("This device")).toBeNull();
    expect(screen.queryByText("Your account")).toBeNull();
    expect(screen.queryByText("This ledger")).toBeNull();
    expect(document.querySelector(".settings-card")).toBeNull();
    await screen.findByText("Two-factor");
  });

  it("chooses the theme with a segmented control named Theme, System first when nothing else is chosen", async () => {
    const { setTheme } = mount({ theme: "system" });
    const theme = within(group("Appearance")).getByRole("radiogroup", {
      name: "Theme",
    });
    expect(
      within(theme)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Light", "Dark", "System"]);
    expect(within(theme).getByRole("radio", { name: "System" })).toBeChecked();
    await userEvent.click(within(theme).getByRole("radio", { name: "Dark" }));
    expect(setTheme).toHaveBeenCalledWith("dark");
    await screen.findByText("Two-factor");
  });

  it("shows the chosen theme as checked, whichever it is", async () => {
    mount({ theme: "dark" });
    const theme = within(group("Appearance")).getByRole("radiogroup", {
      name: "Theme",
    });
    expect(within(theme).getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(
      within(theme).getByRole("radio", { name: "System" }),
    ).not.toBeChecked();
    await screen.findByText("Two-factor");
  });

  it("changes the two device settings with switches, each with one short hint", async () => {
    const { setPrivateMode, setCentsFirst } = mount({ centsFirst: true });
    const privacy = group("Privacy and input");
    const hide = within(privacy).getByRole("switch", { name: "Hide amounts" });
    const cents = within(privacy).getByRole("switch", {
      name: "Type amounts from the cents",
    });
    expect(hide).toHaveAttribute("aria-checked", "false");
    expect(cents).toHaveAttribute("aria-checked", "true");
    expect(hide).toHaveAccessibleDescription("Hides every amount on screen");
    expect(cents).toHaveAccessibleDescription("1, 2, 3 reads 1.23");
    await userEvent.click(hide);
    expect(setPrivateMode).toHaveBeenCalledWith(true);
    await userEvent.click(cents);
    expect(setCentsFirst).toHaveBeenCalledWith(false);
    await screen.findByText("Two-factor");
  });

  it("keeps one row for the data: a link to Import and export, with no downloads of its own", async () => {
    mount();
    const link = within(group("Your data")).getByRole("link", {
      name: /^Import and export/,
    });
    expect(link.getAttribute("href")).toBe("/import");
    expect(link).toHaveTextContent("CSV files, in and out");
    expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();
    expect(screen.queryByLabelText("From date")).toBeNull();
    await screen.findByText("Two-factor");
  });

  it("signs out with a red button of its own", async () => {
    const { signOut } = mount();
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button).toHaveClass("ui-btn-danger");
    await userEvent.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
    await screen.findByText("Two-factor");
  });

  it("shows one notice at a time, from whichever group made a change", async () => {
    mount();
    const select = await screen.findByLabelText("Time zone");
    await vi.waitFor(() => expect(select).toBeEnabled());
    await userEvent.selectOptions(select, "America/Chicago");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Time zone saved.",
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("lets a notice go by itself after a few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const select = await screen.findByLabelText("Time zone");
      await vi.waitFor(() => expect(select).toBeEnabled());
      await user.selectOptions(select, "America/Chicago");
      expect(await screen.findByRole("status")).toBeTruthy();
      await vi.advanceTimersByTimeAsync(3000);
      expect(screen.queryByRole("status")).toBeTruthy();
      await vi.advanceTimersByTimeAsync(1500);
      await vi.waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the same words twice as a new notice, so the timer starts again", async () => {
    mount();
    const select = await screen.findByLabelText("Time zone");
    await vi.waitFor(() => expect(select).toBeEnabled());
    await userEvent.selectOptions(select, "America/Chicago");
    const first = (await screen.findByRole("status")).closest("fieldset");
    await vi.waitFor(() => expect(select).toBeEnabled());
    await userEvent.selectOptions(select, "Asia/Dhaka");
    await vi.waitFor(() =>
      expect(screen.getByRole("status").closest("fieldset")).not.toBe(first),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Time zone saved.");
  });
});
