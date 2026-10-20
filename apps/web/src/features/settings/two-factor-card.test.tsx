import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwoFactorCard } from "./two-factor-card";

const URI =
  "otpauth://totp/Ledgerline:you%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Ledgerline";
const CODES = Array.from({ length: 10 }, (_, i) => `code-${i}-aaaaa`);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const problem = (status: number) =>
  json(
    {
      type: "about:blank",
      title: "Authentication failed",
      status,
      detail: "Check your credentials and try again.",
      errors: [],
    },
    status,
  );

/** A fake server: the answers depend on what was typed, and the session flips as setup finishes. */
function server(startEnabled: boolean) {
  let enabled = startEnabled;
  const bodies: Record<string, unknown[]> = {};
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/v1", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    bodies[path] = [...(bodies[path] ?? []), body];
    if (path === "/auth/get-session")
      return json({
        user: {
          id: "u",
          name: "You",
          email: "you@example.com",
          twoFactorEnabled: enabled,
        },
      });
    if (path === "/auth/two-factor/enable")
      return body.password === "right-password-12"
        ? json({ totpURI: URI, backupCodes: CODES })
        : problem(400);
    if (path === "/auth/two-factor/verify-totp") {
      if (body.code !== "123456") return problem(401);
      enabled = true;
      return json({ status: true });
    }
    if (path === "/auth/two-factor/generate-backup-codes")
      return body.password === "right-password-12"
        ? json({ backupCodes: CODES.map((c) => `new-${c}`) })
        : problem(400);
    if (path === "/auth/two-factor/disable") {
      if (body.password !== "right-password-12") return problem(400);
      enabled = false;
      return json({ status: true });
    }
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { bodies };
}
function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TwoFactorCard />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TwoFactorCard", () => {
  it("sets up two-factor: password, scan and confirm a code, then keep the backup codes", async () => {
    const { bodies } = server(false);
    renderCard();
    expect(await screen.findByText(/^Off\./)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Set up two-factor" }),
    );

    await userEvent.type(
      screen.getByLabelText("Your password"),
      "wrong-password-1",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That password didn't match.",
    );

    await userEvent.clear(screen.getByLabelText("Your password"));
    await userEvent.type(
      screen.getByLabelText("Your password"),
      "right-password-12",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("img", {
        name: "QR code for your authenticator app",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open in my authenticator app" }),
    ).toHaveAttribute("href", URI);

    await userEvent.type(
      screen.getByLabelText("6-digit code from the app"),
      "000000",
    );
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code didn't work.",
    );

    await userEvent.clear(screen.getByLabelText("6-digit code from the app"));
    await userEvent.type(
      screen.getByLabelText("6-digit code from the app"),
      "123 456",
    );
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    const list = await screen.findByRole("list", { name: "Backup codes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    expect(bodies["/auth/two-factor/verify-totp"]?.at(-1)).toEqual({
      code: "123456",
    });

    // The codes stay until the user says they saved them.
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    await userEvent.click(screen.getByLabelText("I saved these codes"));
    await userEvent.click(done);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Two-factor is on.",
    );
    expect(await screen.findByText(/^On\./)).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Backup codes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /QR code/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps management tucked away and makes new backup codes after the password", async () => {
    server(true);
    renderCard();
    expect(await screen.findByText(/^On\./)).toBeInTheDocument();
    const manage = screen.getByText("Manage").closest("details");
    expect(manage).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("Manage"));
    await userEvent.click(
      screen.getByRole("button", { name: "Make new backup codes" }),
    );
    await userEvent.type(
      screen.getByLabelText("Your password"),
      "right-password-12",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Make new codes" }),
    );
    const list = await screen.findByRole("list", { name: "Backup codes" });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(
      "new-code-0",
    );
    await userEvent.click(screen.getByLabelText("I saved these codes"));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "The old ones no longer work.",
    );
  });

  it("turns two-factor off only with the right password, using the red button", async () => {
    const { bodies } = server(true);
    renderCard();
    await screen.findByText(/^On\./);
    await userEvent.click(screen.getByText("Manage"));
    await userEvent.click(
      screen.getByRole("button", { name: "Turn off two-factor" }),
    );
    const confirm = screen.getByRole("button", { name: "Turn off two-factor" });
    expect(confirm).toHaveClass("danger-action");
    await userEvent.type(
      screen.getByLabelText("Your password"),
      "nope-nope-nope",
    );
    await userEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That password didn't match.",
    );
    await userEvent.clear(screen.getByLabelText("Your password"));
    await userEvent.type(
      screen.getByLabelText("Your password"),
      "right-password-12",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Turn off two-factor" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Two-factor is off.",
    );
    expect(await screen.findByText(/^Off\./)).toBeInTheDocument();
    expect(bodies["/auth/two-factor/disable"]).toHaveLength(2);
  });

  it("lets someone cancel a setup that is under way", async () => {
    server(false);
    renderCard();
    await userEvent.click(
      await screen.findByRole("button", { name: "Set up two-factor" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Set up two-factor" }),
    ).toBeInTheDocument();
  });
});
