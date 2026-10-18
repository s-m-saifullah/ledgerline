import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "./download";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("downloadFile", () => {
  it("saves the response under the server's file name and releases the memory", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response("a,b\r\n", {
          headers: {
            "content-disposition":
              'attachment; filename="ledgerline-accounts-2026-10-18.csv"',
          },
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const create = vi.fn(() => "blob:test");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    let saved: { name: string; href: string } | null = null;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        saved = { name: this.download, href: this.href };
      });
    await downloadFile("/ledgers/x/exports/accounts.csv", "fallback.csv");
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/v1/ledgers/x/exports/accounts.csv",
    );
    expect(saved).toEqual({
      name: "ledgerline-accounts-2026-10-18.csv",
      href: "blob:test",
    });
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledWith("blob:test");
    click.mockRestore();
  });

  it("uses the fallback name and reports the API's message when it fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("a\r\n")),
    );
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => undefined,
    });
    let name = "";
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        name = this.download;
      });
    await downloadFile("/p", "fallback.csv");
    expect(name).toBe("fallback.csv");
    click.mockRestore();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: "about:blank",
              title: "Not found",
              status: 404,
              detail: "Ledger not found.",
            }),
            { status: 404 },
          ),
      ),
    );
    await expect(downloadFile("/p", "x.csv")).rejects.toThrow(
      "Ledger not found.",
    );
  });
});
