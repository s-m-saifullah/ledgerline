import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignIn } from "./sign-in";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("validates credentials before sending a request", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<SignIn onSuccess={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(
    await screen.findByText("Enter a valid email address."),
  ).toBeInTheDocument();
  expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

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

async function signInWithPassword() {
  await userEvent.type(
    screen.getByLabelText("Email address"),
    "you@example.com",
  );
  await userEvent.type(screen.getByLabelText("Password"), "a-long-password-12");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("two-factor code step", () => {
  it("asks for a code after the password and signs in only once the code is accepted", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${init?.body ?? ""}`);
      if (url.endsWith("/sign-in/email"))
        return json({ twoFactorRedirect: true });
      if (url.endsWith("/two-factor/verify-totp")) {
        return calls.filter((c) => c.includes("verify-totp")).length === 1
          ? problem(401)
          : json({ token: "x" });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSuccess = vi.fn(async () => {});
    render(<SignIn onSuccess={onSuccess} />);
    await signInWithPassword();
    expect(
      await screen.findByRole("heading", { name: "Two-factor code" }),
    ).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("6-digit code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code didn't work. Check the clock on your phone and try again.",
    );
    expect(onSuccess).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText("6-digit code"));
    await userEvent.type(screen.getByLabelText("6-digit code"), "123 456");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(calls.at(-1)).toContain('{"code":"123456"}');
  });

  it("takes a backup code, explains a lock, and goes back to the password", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/sign-in/email"))
        return json({ twoFactorRedirect: true });
      if (url.endsWith("/verify-backup-code")) return problem(429);
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SignIn onSuccess={vi.fn()} />);
    await signInWithPassword();
    await userEvent.click(
      await screen.findByRole("button", { name: "Use a backup code instead" }),
    );
    await userEvent.type(screen.getByLabelText("Backup code"), "abcd-efgh");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts.",
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/auth/two-factor/verify-backup-code",
      expect.objectContaining({ body: '{"code":"abcd-efgh"}' }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Back to sign in" }),
    );
    expect(
      screen.getByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
  });

  it("signs in straight away when two-factor is off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ token: "x" })),
    );
    const onSuccess = vi.fn(async () => {});
    render(<SignIn onSuccess={onSuccess} />);
    await signInWithPassword();
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Two-factor code")).not.toBeInTheDocument();
  });
});

describe("the redesigned card (ADR 0047)", () => {
  it("is one centred card: the heading is the page's h1, with no marketing half, subtitle or footnote", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<SignIn onSuccess={vi.fn()} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Welcome back" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    for (const text of [
      /Your money\./,
      /A little clarity/i,
      /A quiet place/,
      /Private by design/,
      "Your ledger is only open to you.",
    ])
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    // What the subtitle said is still read aloud, never drawn.
    expect(screen.getByText("Sign in to your personal ledger.")).toHaveClass(
      "sr-only",
    );
    expect(document.querySelector(".sign-in-layout")).toBeNull();
  });

  it("has two plain fields and a button without an arrow", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<SignIn onSuccess={vi.fn()} />);
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(
      screen.getByRole("button", { name: "Sign in" }).querySelector("svg"),
    ).toBeNull();
  });

  it("marks a wrong field and ties its message to it", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<SignIn onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const email = await screen.findByLabelText("Email address");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAttribute("aria-describedby", "email-error");
    expect(document.getElementById("email-error")).toHaveTextContent(
      "Enter a valid email address.",
    );
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("aria-describedby", "password-error");
  });

  it("says Signing in… while it waits, and shows the server's words when it refuses", async () => {
    let release: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    render(<SignIn onSuccess={vi.fn()} />);
    await signInWithPassword();
    const busy = await screen.findByRole("button", { name: "Signing in…" });
    expect(busy).toBeDisabled();
    release(problem(401));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check your credentials and try again.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("falls back to its own words when the failure is not an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "offline";
      }),
    );
    render(<SignIn onSuccess={vi.fn()} />);
    await signInWithPassword();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to sign in.",
    );
  });

  it("titles the page for each step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ twoFactorRedirect: true })),
    );
    render(<SignIn onSuccess={vi.fn()} />);
    expect(document.title).toBe("Sign in · Ledgerline");
    await signInWithPassword();
    await screen.findByRole("heading", { name: "Two-factor code" });
    expect(document.title).toBe("Two-factor code · Ledgerline");
    await userEvent.click(
      screen.getByRole("button", { name: "Back to sign in" }),
    );
    expect(document.title).toBe("Sign in · Ledgerline");
  });
});

describe("the code step's card", () => {
  const toCodeStep = async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/sign-in/email")
          ? json({ twoFactorRedirect: true })
          : problem(401),
      ),
    );
    render(<SignIn onSuccess={vi.fn()} />);
    await signInWithPassword();
    await screen.findByRole("heading", { level: 1, name: "Two-factor code" });
  };

  it("takes the 6-digit code in a large centred field, focused on arrival", async () => {
    await toCodeStep();
    const code = screen.getByLabelText("6-digit code");
    expect(code).toHaveFocus();
    expect(code).toHaveClass("au-code");
    expect(code).toHaveAttribute("placeholder", "000000");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(
      screen.getByText("Enter the 6-digit code from your authenticator app."),
    ).toHaveClass("sr-only");
    expect(
      screen.getByRole("button", { name: "Continue" }).querySelector("svg"),
    ).toBeNull();
    expect(screen.queryByText("Your ledger is only open to you.")).toBeNull();
  });

  it("swaps to a plain backup-code field and back, clearing the code and the error each time", async () => {
    await toCodeStep();
    await userEvent.type(screen.getByLabelText("6-digit code"), "111111");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("alert");
    await userEvent.click(
      screen.getByRole("button", { name: "Use a backup code instead" }),
    );
    const backup = screen.getByLabelText("Backup code");
    expect(backup).toHaveValue("");
    expect(backup).toHaveFocus();
    expect(backup).not.toHaveClass("au-code");
    expect(backup).not.toHaveAttribute("placeholder");
    expect(backup).toHaveAttribute("inputmode", "text");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Enter one of your backup codes.")).toHaveClass(
      "sr-only",
    );
    await userEvent.type(backup, "abcd");
    await userEvent.click(
      screen.getByRole("button", { name: "Use my authenticator app" }),
    );
    const again = screen.getByLabelText("6-digit code");
    expect(again).toHaveValue("");
    expect(again).toHaveFocus();
    expect(again).toHaveClass("au-code");
  });

  it("asks for a code before sending anything", async () => {
    await toCodeStep();
    const fetchMock = vi.mocked(fetch);
    const before = fetchMock.mock.calls.length;
    await userEvent.type(screen.getByLabelText("6-digit code"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the code.",
    );
    expect(screen.getByLabelText("6-digit code")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("says Checking… while it waits and keeps the button for another try after a refusal", async () => {
    let release: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/sign-in/email"))
          return json({ twoFactorRedirect: true });
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );
    render(<SignIn onSuccess={vi.fn()} />);
    await signInWithPassword();
    await userEvent.type(
      await screen.findByLabelText("6-digit code"),
      "123456",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("button", { name: "Checking…" }),
    ).toBeDisabled();
    release(problem(401));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("uses its own words when no answer came", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/sign-in/email"))
          return json({ twoFactorRedirect: true });
        throw new TypeError("offline");
      }),
    );
    render(<SignIn onSuccess={vi.fn()} />);
    await signInWithPassword();
    await userEvent.type(
      await screen.findByLabelText("6-digit code"),
      "123456",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't do that. Please try again.",
    );
  });

  it("says a refused backup code can be used only once, and a refused code to check the clock", async () => {
    await toCodeStep();
    await userEvent.click(
      screen.getByRole("button", { name: "Use a backup code instead" }),
    );
    await userEvent.type(screen.getByLabelText("Backup code"), "abcd-efgh");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That backup code didn't work. Each one can be used only once.",
    );
  });

  it("keeps what was typed on the password step when going back", async () => {
    await toCodeStep();
    await userEvent.click(
      screen.getByRole("button", { name: "Back to sign in" }),
    );
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "you@example.com",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Welcome back" }),
    ).toBeInTheDocument();
  });
});

describe("what assistive technology reads", () => {
  it("names the page's main region by the step's heading and hides the decorative mark", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ twoFactorRedirect: true })),
    );
    const { container } = render(<SignIn onSuccess={vi.fn()} />);
    expect(screen.getByRole("main", { name: "Welcome back" })).toBeVisible();
    expect(container.querySelector(".au-mark")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await signInWithPassword();
    expect(
      await screen.findByRole("main", { name: "Two-factor code" }),
    ).toBeVisible();
    expect(container.querySelector(".au-mark")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
