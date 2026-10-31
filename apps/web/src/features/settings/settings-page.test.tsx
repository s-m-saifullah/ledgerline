import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AmountEntryContext,
  PrivacyControlContext,
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SettingsPage", () => {
  it("changes the device settings through the shared preferences", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ items: [] }))),
    );
    const setTheme = vi.fn();
    const setPrivateMode = vi.fn();
    const setCentsFirst = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ThemeContext value={{ theme: "system", setTheme }}>
          <PrivacyControlContext value={{ privateMode: false, setPrivateMode }}>
            <AmountEntryContext value={{ centsFirst: false, setCentsFirst }}>
              <SettingsPage />
            </AmountEntryContext>
          </PrivacyControlContext>
        </ThemeContext>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "System" })).toHaveProperty(
      "checked",
      true,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(setTheme).toHaveBeenCalledWith("dark");
    await userEvent.click(screen.getByLabelText("Hide amounts"));
    expect(setPrivateMode).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByLabelText("Type amounts from the cents"));
    expect(setCentsFirst).toHaveBeenCalledWith(true);
    expect(screen.getByRole("heading", { name: "Ledger" })).toBeTruthy();
  });

  it("keeps one row for the data: a link to Import and export, with no downloads of its own", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ items: [] }))),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage />
      </QueryClientProvider>,
    );
    const link = screen.getByRole("link", { name: "Import and export" });
    expect(link.getAttribute("href")).toBe("/import");
    expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();
    expect(screen.queryByLabelText("From date")).toBeNull();
    expect(screen.queryByRole("link", { name: "Import from CSV" })).toBeNull();
  });
});
