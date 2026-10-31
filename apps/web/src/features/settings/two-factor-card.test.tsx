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
  const onNotice = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TwoFactorCard onNotice={onNotice} />
    </QueryClientProvider>,
  );
  return { onNotice };
}
// The sheet's title and the field are both "Your password" (as the prototype has them), so ask for the input.
const password = () =>
  screen.getByLabelText("Your password", { selector: "input" });
const pill = (text: string) =>
  screen.findByText(text, { selector: ".ui-pill" });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TwoFactorCard", () => {
  it("sets up two-factor in one sheet: password, scan and confirm a code, then keep the backup codes", async () => {
    const { bodies } = server(false);
    const { onNotice } = renderCard();
    expect(await pill("Off")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Set up two-factor" }),
    );
    expect(screen.getByRole("dialog", { name: "Your password" })).toBeTruthy();

    await userEvent.type(password(), "wrong-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That password didn't match.",
    );

    await userEvent.clear(password());
    await userEvent.type(password(), "right-password-12");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("img", {
        name: "QR code for your authenticator app",
      }),
    ).toBeInTheDocument();
    // The same sheet changed step: one dialog, now named for the scan.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Scan the code" })).toBeTruthy();
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
    expect(screen.getByRole("dialog", { name: "Backup codes" })).toBeTruthy();
    expect(bodies["/auth/two-factor/verify-totp"]?.at(-1)).toEqual({
      code: "123456",
    });

    // The codes stay until the user says they saved them.
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    expect(onNotice).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText("I saved these codes"));
    await userEvent.click(done);
    expect(onNotice).toHaveBeenCalledWith(
      expect.stringContaining("Two-factor is on."),
    );
    expect(await pill("On")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers the codes only once: the step has no Cancel and Escape does not close it", async () => {
    server(false);
    renderCard();
    await userEvent.click(
      await screen.findByRole("button", { name: "Set up two-factor" }),
    );
    await userEvent.type(password(), "right-password-12");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.type(
      await screen.findByLabelText("6-digit code from the app"),
      "123456",
    );
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await screen.findByRole("list", { name: "Backup codes" });
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("list", { name: "Backup codes" })).toBeTruthy();
  });

  it("shows the make-codes and turn-off actions as rows, with no Manage disclosure", async () => {
    server(true);
    renderCard();
    expect(await pill("On")).toBeInTheDocument();
    expect(
      screen.getByText("Asks for a code after your password"),
    ).toBeTruthy();
    expect(screen.queryByText("Manage")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Make new backup codes" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Turn off two-factor" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Set up two-factor" }),
    ).toBeNull();
  });

  it("makes new backup codes after the password", async () => {
    server(true);
    const { onNotice } = renderCard();
    await pill("On");
    await userEvent.click(
      screen.getByRole("button", { name: "Make new backup codes" }),
    );
    await userEvent.type(password(), "right-password-12");
    await userEvent.click(
      screen.getByRole("button", { name: "Make new codes" }),
    );
    const list = await screen.findByRole("list", { name: "Backup codes" });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(
      "new-code-0",
    );
    await userEvent.click(screen.getByLabelText("I saved these codes"));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onNotice).toHaveBeenCalledWith(
      expect.stringContaining("The old ones no longer work."),
    );
  });

  it("turns two-factor off only with the right password, using the red button", async () => {
    const { bodies } = server(true);
    const { onNotice } = renderCard();
    await pill("On");
    await userEvent.click(
      screen.getByRole("button", { name: "Turn off two-factor" }),
    );
    const confirm = screen.getByRole("button", { name: "Turn off two-factor" });
    expect(confirm).toHaveClass("ui-btn-danger-filled");
    await userEvent.type(password(), "nope-nope-nope");
    await userEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That password didn't match.",
    );
    await userEvent.clear(password());
    await userEvent.type(password(), "right-password-12");
    await userEvent.click(
      screen.getByRole("button", { name: "Turn off two-factor" }),
    );
    expect(await pill("Off")).toBeInTheDocument();
    expect(onNotice).toHaveBeenCalledWith("Two-factor is off.");
    expect(bodies["/auth/two-factor/disable"]).toHaveLength(2);
  });

  it("shows the turn-off row in red and the set-up row in the accent", async () => {
    server(true);
    renderCard();
    await pill("On");
    expect(
      screen.getByText("Turn off two-factor").closest(".ui-row-title"),
    ).toHaveClass("set-danger");
    expect(
      screen.getByText("Make new backup codes").closest(".ui-row-title"),
    ).not.toHaveClass("set-danger");
  });

  it("asks for the password before it asks the server anything", async () => {
    const { bodies } = server(false);
    renderCard();
    await userEvent.click(
      await screen.findByRole("button", { name: "Set up two-factor" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter your password.",
    );
    expect(bodies["/auth/two-factor/enable"]).toBeUndefined();
  });

  it("lets someone cancel a setup that is under way, at the password or at the scan", async () => {
    const { bodies } = server(false);
    renderCard();
    await userEvent.click(
      await screen.findByRole("button", { name: "Set up two-factor" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Set up two-factor" }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Set up two-factor" }),
    );
    await userEvent.type(password(), "right-password-12");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("img", { name: /QR code/ });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await pill("Off")).toBeInTheDocument();
    expect(bodies["/auth/two-factor/verify-totp"]).toBeUndefined();
  });

  it("says it is checking, then shows nothing to press if the setting cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    renderCard();
    expect(screen.getByText("Checking your two-factor setting…")).toBeTruthy();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't check your two-factor setting. Please try again later.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is a labelled group named Security with the row named Two-factor", async () => {
    server(true);
    renderCard();
    await pill("On");
    expect(screen.getByRole("heading", { name: "Security" })).toBeTruthy();
    expect(
      screen.getByText("Two-factor", { selector: ".ui-row-title" }),
    ).toBeTruthy();
  });

  it("asks for the box to be ticked again each time new codes are shown", async () => {
    server(true);
    renderCard();
    await pill("On");
    for (let round = 0; round < 2; round++) {
      await userEvent.click(
        screen.getByRole("button", { name: "Make new backup codes" }),
      );
      await userEvent.type(password(), "right-password-12");
      await userEvent.click(
        screen.getByRole("button", { name: "Make new codes" }),
      );
      await screen.findByRole("list", { name: "Backup codes" });
      expect(screen.getByLabelText("I saved these codes")).not.toBeChecked();
      expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
      await userEvent.click(screen.getByLabelText("I saved these codes"));
      await userEvent.click(screen.getByRole("button", { name: "Done" }));
    }
  });

  it("cannot be cancelled while the password is being checked", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server(false);
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/two-factor/enable")) await held;
        return base(url, init);
      }),
    );
    renderCard();
    await userEvent.click(
      await screen.findByRole("button", { name: "Set up two-factor" }),
    );
    await userEvent.type(password(), "right-password-12");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    release();
    await screen.findByRole("img", { name: /QR code/ });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("gives focus back to the row that opened the sheet", async () => {
    server(true);
    renderCard();
    await pill("On");
    await userEvent.click(
      screen.getByRole("button", { name: "Make new backup codes" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Make new backup codes" }),
      ).toHaveFocus(),
    );
  });

  it("draws On in the accent and Off in neutral", async () => {
    server(true);
    renderCard();
    expect(await pill("On")).toHaveClass("ui-pill-accent");
    cleanup();
    server(false);
    renderCard();
    expect(await pill("Off")).toHaveClass("ui-pill-neutral");
  });

  it("cannot be cancelled while the code is being checked", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server(false);
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/verify-totp")) await held;
        return base(url, init);
      }),
    );
    renderCard();
    await userEvent.click(
      await screen.findByRole("button", { name: "Set up two-factor" }),
    );
    await userEvent.type(password(), "right-password-12");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.type(
      await screen.findByLabelText("6-digit code from the app"),
      "123456",
    );
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeDisabled();
    release();
    await screen.findByRole("list", { name: "Backup codes" });
  });
});
