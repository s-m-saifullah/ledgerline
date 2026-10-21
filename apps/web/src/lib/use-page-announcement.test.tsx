import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePageAnnouncement } from "./use-page-announcement";

function Page({
  name,
  withHeading = true,
}: {
  name: string;
  withHeading?: boolean;
}) {
  const announcement = usePageAnnouncement(name);
  return (
    <>
      <main id="main-content" tabIndex={-1}>
        {withHeading && <h1>{name}</h1>}
      </main>
      <p role="status">{announcement}</p>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("usePageAnnouncement", () => {
  it("sets the title and stays quiet on the first load", () => {
    render(<Page name="Budgets" />);
    expect(document.title).toBe("Budgets · Ledgerline");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(document.body).toHaveFocus();
  });

  it("announces a change and focuses the heading", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const view = render(<Page name="Home" />);
    await act(async () => view.rerender(<Page name="Accounts" />));
    expect(document.title).toBe("Accounts · Ledgerline");
    expect(screen.getByRole("status")).toHaveTextContent("Accounts");
    expect(screen.getByRole("heading", { name: "Accounts" })).toHaveFocus();
  });

  it("falls back to the main region when there is no heading yet", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const view = render(<Page name="Home" withHeading={false} />);
    await act(async () =>
      view.rerender(<Page name="Tags" withHeading={false} />),
    );
    expect(document.getElementById("main-content")).toHaveFocus();
  });
});
