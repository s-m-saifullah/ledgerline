import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Overlay } from "./overlay";

afterEach(cleanup);

const base = {
  open: true,
  title: "Add account",
  busy: false,
  onDismiss: () => {},
  returnFocusId: "opener",
  fallbackFocusId: "fallback",
};

describe("Overlay as a sheet", () => {
  it("is a dialog named by its title, with the content in a scrolling body", () => {
    render(
      <Overlay {...base}>
        <p>Name field</p>
      </Overlay>,
    );
    const dialog = screen.getByRole("dialog", { name: "Add account" });
    expect(dialog).toHaveClass("ui-sheet");
    expect(screen.getByText("Name field").closest(".ui-sheet-body")).not.toBe(
      null,
    );
  });

  it("pins the primary button in a footer outside the scrolling body", () => {
    render(
      <Overlay {...base} footer={<button type="button">Save</button>}>
        <p>Name field</p>
      </Overlay>,
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.closest(".ui-sheet-foot")).not.toBe(null);
    expect(save.closest(".ui-sheet-body")).toBe(null);
  });

  it("adds no page landmark: a sheet's head and foot are not a second banner and footer", () => {
    render(
      <Overlay {...base} footer={<button type="button">Save</button>}>
        <p>Name field</p>
      </Overlay>,
    );
    const dialog = screen.getByRole("dialog", { name: "Add account" });
    expect(dialog.querySelector("header, footer")).toBeNull();
  });

  it("draws no footer when there is no primary button", () => {
    render(<Overlay {...base}>content</Overlay>);
    expect(document.querySelector(".ui-sheet-foot")).toBeNull();
  });

  it("has one Cancel, and it dismisses", async () => {
    const onDismiss = vi.fn();
    render(<Overlay {...base} onDismiss={onDismiss} />);
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("can name Cancel something else", () => {
    render(<Overlay {...base} cancelLabel="Close" />);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("shows an optional action in the header", () => {
    render(<Overlay {...base} action={<button type="button">Reset</button>} />);
    expect(
      screen.getByRole("button", { name: "Reset" }).closest(".ui-sheet-head"),
    ).not.toBe(null);
  });

  it("is wider for a wide form", () => {
    const { rerender } = render(<Overlay {...base} />);
    expect(screen.getByRole("dialog")).not.toHaveClass("ui-sheet-wide");
    rerender(<Overlay {...base} size="wide" />);
    expect(screen.getByRole("dialog")).toHaveClass("ui-sheet-wide");
  });

  it("renders nothing while closed", () => {
    render(<Overlay {...base} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps its description for screen readers only, never as a visible paragraph", () => {
    render(<Overlay {...base} description="Add a bank account." />);
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "Add a bank account.",
    );
    expect(screen.getByText("Add a bank account.")).toHaveClass("sr-only");
  });

  it("does not make Radix warn when there is no description", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Overlay {...base} />);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("Overlay dismissing", () => {
  it("closes on Escape", async () => {
    const onDismiss = vi.fn();
    render(<Overlay {...base} onDismiss={onDismiss} />);
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("closes on a click outside", async () => {
    const onDismiss = vi.fn();
    render(<Overlay {...base} onDismiss={onDismiss} />);
    await userEvent.click(document.querySelector(".ui-scrim") as Element);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("while busy, neither Escape nor a click outside nor Cancel dismisses", async () => {
    const onDismiss = vi.fn();
    render(<Overlay {...base} busy onDismiss={onDismiss} />);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(document.querySelector(".ui-scrim") as Element);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Escape closes an open list inside it first, not the dialog", async () => {
    const onDismiss = vi.fn();
    render(
      <Overlay {...base} onDismiss={onDismiss}>
        <input role="combobox" aria-expanded="true" aria-label="Category" />
      </Overlay>,
    );
    screen.getByRole("combobox").focus();
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("Escape in a dialog opened from inside it closes only that one", async () => {
    const onDismiss = vi.fn();
    render(
      <Overlay {...base} onDismiss={onDismiss}>
        <div role="dialog" aria-label="Pick a date">
          <button type="button">Today</button>
        </div>
      </Overlay>,
    );
    screen.getByRole("button", { name: "Today" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

function Harness({ initialFocusId }: { initialFocusId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button id="opener" type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button id="fallback" type="button">
        Fallback
      </button>
      <Overlay
        open={open}
        title="Add account"
        busy={false}
        onDismiss={() => setOpen(false)}
        returnFocusId="opener"
        fallbackFocusId="fallback"
        initialFocusId={initialFocusId}
      >
        <input id="first" aria-label="Name" />
      </Overlay>
    </>
  );
}

describe("Overlay focus", () => {
  it("starts on the field it is told to, and gives focus back to the opener on close", async () => {
    render(<Harness initialFocusId="first" />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Open" })).toHaveFocus(),
    );
  });

  it("with no field named, a sheet starts on its first field, never on Cancel", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
  });

  it("a sheet with nothing to fill starts on its pinned button", async () => {
    render(
      <Overlay {...base} footer={<button type="button">Save</button>}>
        <p>Nothing to type.</p>
      </Overlay>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toHaveFocus(),
    );
  });

  it("a question starts on Cancel, the safe choice", async () => {
    render(
      <Overlay
        {...base}
        kind="question"
        title="Delete?"
        footer={<button type="button">Delete</button>}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );
  });

  it("gives focus to the fallback when the opener is gone", async () => {
    function Gone() {
      const [open, setOpen] = useState(false);
      const [openerShown, setOpenerShown] = useState(true);
      return (
        <>
          {openerShown && (
            <button type="button" onClick={() => setOpen(true)}>
              Open
            </button>
          )}
          <button id="fallback" type="button">
            Fallback
          </button>
          <Overlay
            open={open}
            title="Add account"
            busy={false}
            onDismiss={() => setOpen(false)}
            returnFocusId="missing"
            fallbackFocusId="fallback"
          >
            <button type="button" onClick={() => setOpenerShown(false)}>
              Remove opener
            </button>
          </Overlay>
        </>
      );
    }
    render(<Gone />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Remove opener" }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Fallback" })).toHaveFocus(),
    );
  });
});

describe("Overlay as a question", () => {
  it("is a centred dialog with Cancel beside the one confirming button, and no grab handle", async () => {
    const onDismiss = vi.fn();
    render(
      <Overlay
        {...base}
        kind="question"
        title="Delete this account?"
        onDismiss={onDismiss}
        footer={
          <button type="button" className="ui-btn ui-btn-danger-filled">
            Delete
          </button>
        }
      >
        <p>It can be restored.</p>
      </Overlay>,
    );
    const dialog = screen.getByRole("dialog", { name: "Delete this account?" });
    expect(dialog).toHaveClass("ui-question");
    expect(dialog).not.toHaveClass("ui-sheet");
    expect(dialog.querySelector(".ui-grab")).toBeNull();
    const actions = dialog.querySelector(".ui-question-actions");
    expect(actions).not.toBeNull();
    expect(actions).toContainElement(
      screen.getByRole("button", { name: "Cancel" }),
    );
    expect(actions).toContainElement(
      screen.getByRole("button", { name: "Delete" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
