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
