import { act, cleanup, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PageAdd, PageAddProvider, usePageAdd } from "./page-add";

function Host({ children }: { children: ReactNode }) {
  const [add, setAdd] = useState<PageAdd | null>(null);
  return (
    <PageAddProvider value={setAdd}>
      <p data-testid="shell">
        {add ? `${add.label}${add.disabled ? " (off)" : ""}` : "transaction"}
      </p>
      <button type="button" onClick={() => add?.onClick()}>
        fab
      </button>
      {children}
    </PageAddProvider>
  );
}
function Page({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  usePageAdd({ label, disabled: disabled ?? false, onClick });
  return null;
}

describe("a page's own Add", () => {
  afterEach(cleanup);
  it("shows the page's label while it is on screen and puts the transaction back after", () => {
    const { rerender } = render(
      <Host>
        <Page label="Add client" onClick={() => {}} />
      </Host>,
    );
    expect(screen.getByTestId("shell").textContent).toBe("Add client");
    rerender(<Host>{null}</Host>);
    expect(screen.getByTestId("shell").textContent).toBe("transaction");
  });

  it("follows the label and the disabled state as they change", () => {
    const { rerender } = render(
      <Host>
        <Page label="Add client" onClick={() => {}} />
      </Host>,
    );
    rerender(
      <Host>
        <Page label="Log service" disabled onClick={() => {}} />
      </Host>,
    );
    expect(screen.getByTestId("shell").textContent).toBe("Log service (off)");
  });

  it("follows the disabled state when only that changes", () => {
    const { rerender } = render(
      <Host>
        <Page label="Add client" onClick={() => {}} />
      </Host>,
    );
    expect(screen.getByTestId("shell").textContent).toBe("Add client");
    rerender(
      <Host>
        <Page label="Add client" disabled onClick={() => {}} />
      </Host>,
    );
    expect(screen.getByTestId("shell").textContent).toBe("Add client (off)");
  });

  it("goes back to the transaction when a page stops asking for its own Add", () => {
    function Maybe({ on }: { on: boolean }) {
      usePageAdd(
        on ? { label: "Add client", disabled: false, onClick: () => {} } : null,
      );
      return null;
    }
    const { rerender } = render(
      <Host>
        <Maybe on />
      </Host>,
    );
    expect(screen.getByTestId("shell").textContent).toBe("Add client");
    rerender(
      <Host>
        <Maybe on={false} />
      </Host>,
    );
    expect(screen.getByTestId("shell").textContent).toBe("transaction");
  });

  it("runs the latest click handler, not the first one", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Host>
        <Page label="Add client" onClick={first} />
      </Host>,
    );
    rerender(
      <Host>
        <Page label="Add client" onClick={second} />
      </Host>,
    );
    act(() => screen.getByText("fab").click());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("does nothing outside a shell", () => {
    render(<Page label="Add client" onClick={() => {}} />);
  });
});
