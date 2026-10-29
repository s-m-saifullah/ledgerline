import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SyncStatus } from "./sync-status";

afterEach(cleanup);

describe("SyncStatus", () => {
  it.each([
    ["synced", "Synced"],
    ["updating", "Updating"],
    ["offline", "Offline"],
  ] as const)("says %s in words, in a polite live region", (state, words) => {
    const { container } = render(<SyncStatus state={state} />);
    const status = container.querySelector(".ui-sync");
    expect(status).toHaveTextContent(words);
    expect(status).toHaveAttribute("data-state", state);
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("is not a status role, which pages use for their own notices", () => {
    render(<SyncStatus state="synced" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("marks the state with a dot that screen readers skip", () => {
    const { container } = render(<SyncStatus state="offline" />);
    expect(container.querySelector(".ui-sync-dot")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
