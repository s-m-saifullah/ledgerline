import { newId } from "@ledgerline/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyContext } from "../../lib/preferences";
import { HomePage } from "./home-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("../transactions/workspace", () => ({
  useTransactionWorkspace: () => null,
}));
vi.mock("../currencies/base-value", () => ({
  useBaseValues: () => ({
    baseCurrency: "USD",
    currencies: ["USD"],
    baseValue: () => null,
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Home at start-up", () => {
  it("asks for the accounts as soon as the ledger is known, without waiting for the summary", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        // The summary never answers: a request that waits for it would never be made.
        if (url.includes("/home"))
          return new Promise<Response>(() => undefined);
        if (url.includes("/accounts"))
          return Promise.resolve(
            new Response(JSON.stringify({ items: [], nextCursor: null })),
          );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: newId(),
                  name: "Personal",
                  baseCurrency: "USD",
                  timeZone: null,
                  version: 1,
                  role: "owner",
                },
              ],
            }),
          ),
        );
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PrivacyContext value={false}>
          <HomePage />
        </PrivacyContext>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(requests.some((url) => url.includes("/accounts"))).toBe(true),
    );
  });
});
